/**
 * The user only ever sees the platform name "CreatorOS". API error bodies
 * and doc links can contain the internal vendor name — every string that
 * could surface to the user or the agent passes through here first.
 */
const VENDOR = /zernio/gi;

export function sanitize(text: string): string {
  return text
    .replace(/https?:\/\/docs\.zernio\.com\S*/gi, 'the CreatorOS docs')
    .replace(VENDOR, 'CreatorOS');
}
