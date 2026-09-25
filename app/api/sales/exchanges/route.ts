import { NextRequest, NextResponse } from 'next/server';
import { withTransaction, getNextMCNumber, getNextSINumber, query } from '@/lib/mysql';
import { processReturnLeg } from '@/lib/pos/process-return-leg';
import { processSaleLeg } from '@/lib/pos/process-sale-leg';
import { getBatchCostingSettings } from '@/lib/batch-deduction';
import { isService } from '@/lib/product-type';
import { ensureCustomerCreditColumn } from '@/lib/ensure-customer-credit';
import { saveEJournalFiles } from '@/lib/ejournal/ejournal-writer';
import { EXCHANGE_CREDIT_TENDER, isExchangeBalanceTender } from '@/lib/pos/exchange-tender';

/**
 * POST /api/sales/exchanges — 1-for-1 item exchange.
 *
 * Performs a return of returnItem and a sale of newItem inside ONE
 * withTransaction so a failure in either leg (e.g. oversell-block on the
 * replacement item) leaves stock, the shared SI/MC counters, and both
 * pos_transactions rows completely unwritten. transaction_type stays limited
 * to the existing 'return'/'sale' enum values — there is no 'exchange' value
 * — the two legs are correlated after the fact via exchange_group_id.
 */
export async function POST(request: NextRequest) {
  try {
    await ensureCustomerCreditColumn();
    const body = await request.json();
    const {
      saleId,
      returnItem,
      newItem,
      balancePayment,
      terminalId,
      userId,
      shiftId,
      customerId,
    } = body;

    if (!saleId || !returnItem || !newItem) {
      return NextResponse.json({ success: false, error: 'saleId, returnItem, and newItem are required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    const returnTotal = Number(returnItem.quantity) * Number(returnItem.price);
    const newTotal = Number(newItem.quantity) * Number(newItem.price);
    const balance = Math.round((newTotal - returnTotal) * 100) / 100;

    // Server-side backstops — the UI is expected to validate these too, but
    // this route must not trust that: balance > 0 needs enough tendered cash,
    // balance < 0 (a downsell) needs a customer to credit the difference to.
    const balanceReference: string | null =
      typeof balancePayment?.reference === 'string' && balancePayment.reference.trim()
        ? balancePayment.reference.trim()
        : null;
    if (balance > 0) {
      const tendered = Number(balancePayment?.amountTendered ?? 0);
      if (!balancePayment || !Number.isFinite(tendered) || tendered < balance) {
        return NextResponse.json({ success: false, error: `Insufficient payment for balance of ${balance.toFixed(2)}` }, { status: 400 });
      }
      // Spec Global Constraint: the balance is settled by cash or card only.
      // The view filters its dropdown the same way, but this is the real
      // enforcement — POINTS would record a paid sale with no points deducted,
      // CHARGE a 'Paid' sale with no receivable.
      if (!isExchangeBalanceTender(balancePayment.method)) {
        return NextResponse.json({ success: false, error: `Exchange balance must be paid by cash or card, not "${balancePayment.method ?? ''}"` }, { status: 400 });
      }
      // A method configured with require_reference (e.g. Credit Card) needs a
      // reference number. The regular tender only checks this client-side
      // (use-tender.ts, from payment_methods.require_reference); this route
      // reads the same column so a direct call can't skip it. A method with
      // no payment_methods row falls back to "not required", matching the
      // client's `method?.isReferenceRequired || false`.
      const methodRows: any = await query(
        'SELECT require_reference FROM payment_methods WHERE UPPER(name) = UPPER(?) LIMIT 1',
        [balancePayment.method]
      );
      if (methodRows?.[0]?.require_reference && !balanceReference) {
        return NextResponse.json({ success: false, error: `A reference number is required for ${balancePayment.method} payments` }, { status: 400 });
      }
    }
    if (balance < 0 && !customerId) {
      return NextResponse.json({ success: false, error: 'A customer must be attached to the original sale to credit a downsell balance' }, { status: 400 });
    }

    const productTypeRows: any = await query(
      'SELECT id, type FROM products WHERE id IN (?, ?)',
      [returnItem.productId, newItem.productId]
    );
    const typeById = new Map<string, string | null>(
      productTypeRows.map((r: any) => [r.id, r.type])
    );
    if (isService({ type: typeById.get(returnItem.productId) }) || isService({ type: typeById.get(newItem.productId) })) {
      return NextResponse.json({ success: false, error: 'Exchanges do not support service products in v1' }, { status: 400 });
    }

    const posSettingsRows: any = await query('SELECT is_training_mode FROM pos_settings LIMIT 1');
    const isTrainingMode = posSettingsRows?.[0]?.is_training_mode || false;

    const returnPosTransId = `RTN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const salePosTransId = `PT-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newSaleId = `SALE-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const exchangeGroupId = `EXG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    const result = await withTransaction(async (connection) => {
      let finalUserId = userId;
      const [userResult]: any = await connection.query('SELECT uid FROM users WHERE uid = ? LIMIT 1', [userId]);
      if (!userResult || userResult.length === 0) {
        const [anyUser]: any = await connection.query('SELECT uid FROM users LIMIT 1');
        finalUserId = anyUser?.[0]?.uid || 'system';
      }

      let finalShiftId = shiftId || null;
      if (!finalShiftId && terminalId) {
        const [openShift]: any = await connection.query(
          "SELECT id FROM shifts WHERE terminal_id = ? AND status = 'active' ORDER BY start_time DESC LIMIT 1",
          [terminalId]
        );
        finalShiftId = openShift?.[0]?.id || null;
      }

      // Training mode skips BOTH numbering series (spec Global Constraints):
      // a training exchange must not burn a real MC number any more than a
      // real SI number, or the printed slip sequence shows a gap.
      const mcNumber = isTrainingMode ? null : await getNextMCNumber(connection);
      const siNumber = isTrainingMode ? null : await getNextSINumber(connection);

      // --- RETURN LEG ---
      // is_training is set on this leg too, exactly like the sale leg: X/Z
      // filter on pt.is_training = 0, so an unflagged return leg would count a
      // training exchange as a REAL return and drop real net sales.
      await connection.query(
        `INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, mc_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, notes, is_training, exchange_group_id, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'return', ?, ?, 0, 0, ?, 'Return', 'completed', ?, ?, ?, NOW(), NOW(), NOW())`,
        [
          returnPosTransId, saleId, finalShiftId, finalUserId, terminalId || null,
          mcNumber, -returnTotal, -returnTotal,
          'Exchange (return leg)', isTrainingMode, exchangeGroupId,
        ]
      );

      const returnLegResult = await processReturnLeg(connection, {
        saleId,
        item: returnItem,
        posTransId: returnPosTransId,
        itemIndex: 0,
      });

      await connection.query(
        `INSERT INTO pos_transaction_items (
          id, pos_transaction_id, sale_item_id, product_id, product_name,
          quantity, unit_price, line_total,
          selling_unit_id, selling_unit_name, selling_unit_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          `${returnPosTransId}-DETAIL-1`, returnPosTransId, returnLegResult.saleItemId,
          returnItem.productId, returnItem.productName,
          -Number(returnItem.quantity), returnItem.price, -(Number(returnItem.quantity) * returnItem.price),
          returnLegResult.unitId, returnLegResult.unitName, returnLegResult.factor,
        ]
      );

      // --- SALE LEG TENDER ---
      // The sale leg is paid by (a) the returned item's value, up to newTotal,
      // and (b) on an upsell, the balance the cashier actually collected. Only
      // (b) is new money in the drawer. Both are written as payment_details
      // rows below: without them every reconciler falls back to counting the
      // FULL pt.total_amount under pt.payment_method, which made each exchange
      // look like newTotal of fresh cash had been received (a phantom drawer
      // shortage equal to the returned value).
      const creditPortion = Math.round(Math.min(returnTotal, newTotal) * 100) / 100;
      const collectsBalance = balance > 0;
      // Same convention as checkout / use-tender.ts: 'MULTIPLE' when the sale
      // has more than one payment_details row.
      const saleLegPaymentMethod = collectsBalance
        ? (creditPortion > 0 ? 'MULTIPLE' : String(balancePayment.method))
        : EXCHANGE_CREDIT_TENDER;
      const firstPaymentDetailsId = `PD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

      // --- SALE LEG ---
      // sales_transactions must be inserted BEFORE processSaleLeg runs: it
      // writes sale_items rows FK'd to sales_transactions(id), so newSaleId
      // has to exist first or the insert fails its foreign key constraint.
      await connection.query(
        `INSERT INTO sales_transactions (
          id, reference, receipt_number, si_number, customer_id, invoice_date, date, total, payment_method, status, transaction_source, notes, is_training, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, CURDATE(), CURDATE(), ?, ?, 'Paid', 'POS', ?, ?, NOW(), NOW())`,
        [
          newSaleId, `EXG-REF-${newSaleId}`, siNumber,
          customerId || null, newTotal, saleLegPaymentMethod,
          'Exchange (sale leg)', isTrainingMode,
        ]
      );

      const bcs = await getBatchCostingSettings(connection as any);
      const saleLegResult = await processSaleLeg(connection, {
        item: {
          id: newItem.productId,
          name: newItem.productName,
          quantity: newItem.quantity,
          price: newItem.price,
          discount: 0,
          sellingUnitId: newItem.sellingUnitId,
          sellingUnitName: newItem.sellingUnitName,
          sellingUnitFactor: newItem.sellingUnitFactor,
        },
        saleId: newSaleId,
        itemIndex: 0,
        oversellBlock: bcs.oversellBlock,
      });

      await connection.query(
        `INSERT INTO pos_transactions (
          id, sale_id, shift_id, user_id, terminal_id, transaction_type, si_number,
          subtotal, tax_amount, discount_amount, total_amount, payment_method,
          payment_status, payment_details_id, payment_validated_at,
          notes, is_training, exchange_group_id, transaction_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, 0, 0, ?, ?, 'completed', ?, NOW(), ?, ?, ?, NOW(), NOW(), NOW())`,
        [
          salePosTransId, newSaleId, finalShiftId, finalUserId, terminalId || null,
          siNumber, newTotal, newTotal, saleLegPaymentMethod, firstPaymentDetailsId,
          'Exchange (sale leg)', isTrainingMode, exchangeGroupId,
        ]
      );

      // payment_details for the sale leg — same insert shape as checkout's
      // split-tender path. Reconcilers sum (amount_tendered - change_given)
      // per payment_method, so: EXCHANGE CREDIT nets to creditPortion (never
      // cash), and the balance row nets to exactly `balance` under its real
      // cash/card method.
      const paymentRows: any[][] = [];
      if (creditPortion > 0) {
        paymentRows.push([
          firstPaymentDetailsId, salePosTransId, EXCHANGE_CREDIT_TENDER, null,
          creditPortion, 0, `Returned item value (${exchangeGroupId})`,
        ]);
      }
      if (collectsBalance) {
        const tendered = Math.round(Number(balancePayment.amountTendered) * 100) / 100;
        const changeGiven = Math.round((tendered - balance) * 100) / 100;
        paymentRows.push([
          paymentRows.length === 0 ? firstPaymentDetailsId : `PD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          salePosTransId, String(balancePayment.method), balanceReference,
          tendered, changeGiven, `Exchange balance (${exchangeGroupId})`,
        ]);
      }
      for (const row of paymentRows) {
        await connection.query(
          `INSERT INTO payment_details (
            id, transaction_id, payment_method, gateway_reference,
            amount_tendered, change_given, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          row
        );
      }

      await connection.query(
        `INSERT INTO pos_transaction_items (
          id, pos_transaction_id, sale_item_id, product_id, product_name,
          quantity, unit_price, line_total,
          selling_unit_id, selling_unit_name, selling_unit_factor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          `${salePosTransId}-DETAIL-1`, salePosTransId, saleLegResult.itemId,
          newItem.productId, newItem.productName,
          Number(newItem.quantity), newItem.price, newTotal,
          saleLegResult.unitId, saleLegResult.unitName, saleLegResult.factor,
        ]
      );

      // --- BALANCE SETTLEMENT ---
      // balance > 0 (customer owes more) is collected via balancePayment and
      // recorded as the sale leg's second payment_details row above.
      // balance < 0 (customer is owed) credits their account.
      if (balance < 0 && customerId) {
        await connection.query(
          'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, updated_at = NOW() WHERE id = ?',
          [Math.abs(balance), customerId]
        );
      }

      const [meta]: any = await connection.query(
        `SELECT DATE(transaction_time) AS d, terminal_id AS t FROM pos_transactions WHERE id = ? LIMIT 1`,
        [salePosTransId]
      );

      return {
        exchangeGroupId,
        returnPosTransId,
        salePosTransId,
        mcNumber,
        siNumber,
        balance,
        d: meta?.[0]?.d ? String(meta[0].d) : null,
        t: meta?.[0]?.t ?? 'all',
      };
    });

    if (result.d) {
      saveEJournalFiles(result.d, result.t).catch((e) => console.error('e-journal auto-save failed:', e));
    }

    return NextResponse.json({
      success: true,
      data: {
        exchangeGroupId: result.exchangeGroupId,
        returnPosTransId: result.returnPosTransId,
        salePosTransId: result.salePosTransId,
        mcNumber: result.mcNumber,
        siNumber: result.siNumber,
        balance: result.balance,
      },
    });
  } catch (error: any) {
    console.error('Error processing exchange:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process exchange' },
      { status: 500 }
    );
  }
}
