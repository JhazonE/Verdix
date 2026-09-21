import { SaleRepository } from '../domain/ISaleRepository';
import { SaleEntity, SaleItemEntity } from '../domain/Sale';
import { InventorySyncService } from '../../../infrastructure/services/InventorySyncService';
import { getNextReference, getNextReceiptNumber } from '../../../../lib/mysql';
import { PoolConnection } from 'mysql2/promise';
import { deductFromBatches, getBatchCostingSettings } from '../../../../lib/batch-deduction';
import { baseQuantity } from '../../../../lib/selling-units';

const VAT_RATE = 0.12;

export interface CreateSaleRequest {
  customer: { id: string; name: string };
  invoiceDate: string;
  dueDate?: string;
  reference?: string;
  paymentMethod: string;
  paymentReference?: string;
  status: any;
  notes?: string;
  items: any[];
  shipping?: number;
}

export class CreateSaleUseCase {
  constructor(
    private saleRepository: SaleRepository,
    private inventoryService: InventorySyncService
  ) {}

  async execute(request: CreateSaleRequest): Promise<string> {
    const saleId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Prices are VAT-exclusive here — a VATable line adds 12% on top rather
    // than having VAT backed out of an inclusive price the way POS does.
    // `item.vatable` is the per-line checkbox from the form: it defaults
    // from the product's own vatStatus but staff can override it per line,
    // so the charge follows the submitted flag, not a re-derived status.
    let itemsTotal = 0;
    let vatAmount = 0;
    for (const item of request.items) {
      const lineTotal = item.price * item.quantity;
      itemsTotal += lineTotal;
      if (item.vatable) vatAmount += lineTotal * VAT_RATE;
    }
    const total = itemsTotal + vatAmount + (request.shipping || 0);

    // Generate reference if needed
    let finalReference = request.reference;
    if (!finalReference || finalReference.trim() === '') {
      const nextVal = await getNextReference('sales_invoice');
      finalReference = `INV-${nextVal.toString().padStart(6, '0')}`;
    }

    const receiptNumber = await getNextReceiptNumber();

    const saleEntity: SaleEntity = {
      id: saleId,
      customerId: request.customer.id,
      reference: finalReference,
      receiptNumber,
      invoiceDate: request.invoiceDate,
      dueDate: request.dueDate,
      total,
      vatAmount,
      paymentMethod: request.paymentMethod,
      paymentReference: request.paymentReference,
      status: request.status || 'Pending',
      transactionSource: 'Backoffice',
      notes: request.notes,
      items: request.items.map((item, index) => ({
        id: `${saleId}_item_${index + 1}`,
        saleId: saleId,
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.price,
        sellingUnitId: item.sellingUnitId ?? null,
        sellingUnitName: item.sellingUnitName ?? null,
        sellingUnitFactor: item.sellingUnitFactor ?? null,
        vatable: Boolean(item.vatable),
      }))
    };

    // Execute within repository transaction
    await this.saleRepository.saveWithTransaction(saleEntity, async (connection: PoolConnection) => {
      // Get batch costing settings
      const { oversellBlock } = await getBatchCostingSettings(connection);

      // 1. Check and deduct inventory for each item
      for (let i = 0; i < request.items.length; i++) {
        const item = request.items[i];
        const productId = item.product.id;
        const factor = Number(item.sellingUnitFactor) > 0 ? Number(item.sellingUnitFactor) : 1;
        const qtyInBase = baseQuantity(item.quantity, factor);
        const saleItemId = `${saleId}_item_${i + 1}`;

        await this.inventoryService.checkStockAvailability(productId, qtyInBase, connection);

        // --- BATCH COSTING: FIFO Deduction ---
        const deduction = await deductFromBatches(productId, qtyInBase, oversellBlock, connection);

        // Update the specific sale_item with cost info and batch splits
        await connection.query(
          `UPDATE sales_invoice_items
           SET cost_at_sale = ?, batch_source = ?
           WHERE id = ?`,
          [deduction.weightedAvgCost, JSON.stringify(deduction.splits), saleItemId]
        );
        // --- END BATCH COSTING ---

        await this.inventoryService.deductStockWithFamilySync(
          { productId: productId, quantity: qtyInBase },
          saleId,
          `Sales Invoice: ${finalReference} (Sync from Anchor: ${item.product.name})`,
          connection
        );
      }
    });

    // Handle External Sync (Fire and forget, logic from route.ts)
    this.triggerExternalSync(saleEntity, request.customer, request.items);

    return saleId;
  }

  private async triggerExternalSync(sale: SaleEntity, customer: any, items: any[]) {
    try {
      const { getExternalApiConfig } = await import('../../../../lib/external-api-config');
      const { syncSalesTransaction } = await import('../../../../lib/services/external-accounting-api');
      
      const apiConfig = await getExternalApiConfig();
      if (apiConfig.enabled) {
        const salesData = {
          id: sale.id,
          customer,
          invoiceDate: sale.invoiceDate,
          total: sale.total,
          paymentMethod: sale.paymentMethod,
          paymentReference: sale.paymentReference,
          status: sale.status,
          items,
        };
        
        syncSalesTransaction(sale.id, salesData, apiConfig).catch((err: any) => {
          console.error('Sales sync failed (non-blocking):', err);
        });
      }
    } catch (err) {
      console.error('Error triggering sales sync:', err);
    }
  }
}
