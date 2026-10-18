/**
 * Text from other people's profiles is DATA. Names and bios are written by strangers (sometimes to fool an AI that reads them),
 * so before any of it is put in front of the model it is reduced to a short plain label, and anything that reads like an
 * instruction is replaced. The shortlist cards on screen are plain text and need no such care.
 *
 * Pure.
 */

const COMMAND =
  /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instructions?|rules?|prompts?|above|previous)\b|\bsystem prompt\b|\b(?:you (?:must|should|are now)|act as|pretend to be|new instructions?)\b|\b(?:send|transfer|pay|wire)\b[^.]{0,30}(?:\$|usdt|usdc|usat|0x[0-9a-f]{6,})|\bassistant\s*:|\bsystem\s*:|<\/?[a-z][^>]*>/i;

/** A name or handle made safe to show a model: control characters, brackets and quotes stripped, clipped, instructions replaced. */
export function untrustedLabel(text: unknown, max = 40): string {
  if (typeof text !== 'string') return 'unnamed';
  const flat = text
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/[`"'\[\]{}<>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return 'unnamed';
  if (COMMAND.test(text)) return 'unreadable name';
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

/** True when a piece of profile text is trying to give orders (used to show a warning on the card). */
export function looksLikeInstruction(text: unknown): boolean {
  return typeof text === 'string' && COMMAND.test(text);
}
