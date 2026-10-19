import { getApiUrl } from '@/lib/api-config';
import { printStockAdjustment, type AdjustmentSlipData } from '@/lib/print-stock-adjustment';

export type ReprintTarget =
  | { batchId: string }
  | { transferId: string }
  | { adjustmentId: string };

export type ReprintResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'popup-blocked' | 'error'; message: string };

/**
 * Fetches an already-committed adjustment from the server and prints its slip
 * again, marked as a REPRINT.
 *
 * Shared by every screen that offers a reprint (inventory history, the
 * adjustments report, the batch list) so they cannot drift apart in what the
 * reprinted document says.
 *
 * The caller is expected to surface the failure reasons — a silently missing
 * slip on an inventory control document is worse than an error message.
 */
export async function reprintStockAdjustment(
  target: ReprintTarget,
  options: { preparedBy?: string | null } = {}
): Promise<ReprintResult> {
  const params = new URLSearchParams(target as Record<string, string>);

  try {
    const res = await fetch(getApiUrl(`/inventory/adjust/slip?${params.toString()}`));
    const payload = await res.json();

    if (!res.ok || !payload?.success) {
      return {
        ok: false,
        reason: res.status === 404 ? 'not-found' : 'error',
        message: payload?.error || 'Could not load this transaction.',
      };
    }

    const slip: AdjustmentSlipData = {
      ...payload.data,
      // Whoever prepared the original is not recorded against the adjustment,
      // so the reprint leaves the Prepared By line blank to be signed by hand
      // rather than crediting whoever happens to be reprinting it.
      preparedBy: options.preparedBy ?? null,
      isReprint: true,
    };

    const printed = await printStockAdjustment(slip);
    return printed
      ? { ok: true }
      : {
          ok: false,
          reason: 'popup-blocked',
          message: 'Your browser blocked the print window. Allow popups for this site and try again.',
        };
  } catch (error: any) {
    return { ok: false, reason: 'error', message: error?.message || 'Could not load this transaction.' };
  }
}
