/**
 * Edition feature gating. Features are carried inside the vendor-signed
 * payload, so they cannot be granted by editing local config.
 */
import { readLicensePayloadAsync } from './verify';

/** Pure membership check — case-insensitive, whitespace-tolerant. */
export function hasFeatureIn(features: string[] | undefined, name: string): boolean {
  if (!features?.length) return false;
  const want = name.trim().toLowerCase();
  return features.some((f) => String(f).trim().toLowerCase() === want);
}

/** True when the installed license grants the named feature. */
export async function hasFeature(name: string): Promise<boolean> {
  const payload = await readLicensePayloadAsync();
  return hasFeatureIn(payload?.features, name);
}
