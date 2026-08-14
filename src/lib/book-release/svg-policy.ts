import { createHash } from 'node:crypto';

export const APPROVED_READER_SVG_DIGESTS: readonly string[] = Object.freeze([
  '9c4401faf995b0bd954379e56087ac818bf35f73657a335f3d91835bd6ba482d',
  '4c129fe85208d046c53cee25d8309a7069efef7f47e1ceb18885cfdb429117a9',
]);
const approvedReaderSvgDigests = new Set(APPROVED_READER_SVG_DIGESTS);

export function assertApprovedReaderSvgBytes(bytes: Uint8Array, label: string): void {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!approvedReaderSvgDigests.has(digest)) {
    throw new Error(`${label} is not an approved immutable reader SVG`);
  }
}
