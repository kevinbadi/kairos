/**
 * API keys must never appear in full in any log line or file.
 * Always render them as `sk_...last4`.
 */
export function maskKey(key: string): string {
  if (!key) return 'sk_...';
  const last4 = key.length > 8 ? key.slice(-4) : '';
  return `sk_...${last4}`;
}
