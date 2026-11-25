'use client';

import type { Product } from '@/lib/types';

import type { LabelSize } from './barcode-utils';

const PREVIEW_W = 300;

export function PreviewLabel({
  product,
  size,
  dataUrl,
  showName,
  showPrice,
}: {
  product: Product;
  size: LabelSize;
  dataUrl: string | null;
  showName: boolean;
  showPrice: boolean;
}) {
  const previewH    = Math.round((size.height / size.width) * PREVIEW_W);
  const scale       = PREVIEW_W / (size.width * 3.78);
  const nameFontPx  = Math.round(size.fontSize * 1.33 * scale);
  const priceFontPx = Math.round((size.fontSize + 1) * 1.33 * scale);

  return (
    // Outer box — fixed size, centers the inner group
    <div
      style={{
        width: PREVIEW_W,
        height: previewH,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
        border: '1px solid #d1d5db',
        borderRadius: 6,
        background: '#fff',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Inner group — shrinks to content, name/barcode/price are tight */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          fontFamily: 'monospace',
        }}
      >
        {showName && (
          <div
            style={{
              fontSize: nameFontPx,
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.1,
              flex: 'none',
              width: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 0,
            }}
          >
            {product.name}
          </div>
        )}

        {dataUrl ? (
          <img
            src={dataUrl}
            alt="barcode preview"
            // Shrinks to leave room for name + price so neither gets clipped.
            style={{ display: 'block', width: '100%', height: 'auto', flex: '0 1 auto', minHeight: 0, objectFit: 'contain' }}
          />
        ) : (
          <div style={{ fontSize: 12, color: '#9ca3af', padding: '6px 0' }}>
            Invalid barcode value
          </div>
        )}

        {showPrice && typeof product.price === 'number' && (
          <div
            style={{
              fontSize: priceFontPx,
              fontWeight: 700,
              textAlign: 'center',
              lineHeight: 1.1,
              flex: 'none',
              marginTop: 3,
            }}
          >
            ₱{product.price.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}
