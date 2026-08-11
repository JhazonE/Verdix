import type { ProductType } from '@/lib/product-type';

/**
 * Resolves a cart's single BIR document type (goods → Sales Invoice,
 * services → Official Receipt), or throws if the cart mixes both.
 *
 * Missing/unknown type defaults to 'standard', matching isService()'s
 * false-default direction in lib/product-type.ts — a bad read must never
 * misclassify a sale as services.
 */
export function validateSingleDocumentType(items: { type?: string | null }[]): ProductType {
  const types = new Set(items.map(item => (item.type === 'service' ? 'service' : 'standard')));
  if (types.size > 1) {
    throw new Error('Cannot mix goods and services in one sale — please complete this as two separate transactions.');
  }
  return types.has('service') ? 'service' : 'standard';
}
