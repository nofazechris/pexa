/**
 * The four stages Pexa goes through while it works: thinking, searching, walking (going through things one by one) and solving
 * (putting an answer together). Each has an orb state and a plain label. Pure.
 *
 * Research runs report their real steps, so their stage comes from what is actually happening. A chat turn is one request that
 * doesn't stream its progress, so the stage there follows how long the wait has lasted; the labels stay generic ("looking things
 * up") and never name something that may not be happening.
 */

export type Stage = 'thinking' | 'searching' | 'walking' | 'solving';

/** The orb state each stage uses (what they look like: a calm ring, a dotted globe, scattered dots on the move, a converging sphere). */
export const ORB_STATE = { thinking: 'breathing', searching: 'searching', walking: 'working', solving: 'solving' } as const;

export const STAGE_LABEL: Record<Stage, string> = {
  thinking: 'Thinking…',
  searching: 'Looking things up…',
  walking: 'Working through it…',
  solving: 'Putting it together…',
};

/** A chat turn that has been waiting this long (ms) is in this stage. */
export function stageForWait(elapsedMs: number): Stage {
  if (elapsedMs < 3_000) return 'thinking';
  if (elapsedMs < 8_000) return 'searching';
  if (elapsedMs < 14_000) return 'walking';
  return 'solving';
}

/** Shown between research purchases: the answer that just arrived is being read and scored. */
export const LABEL_READING = 'Reading what came back';

/** The stage of a research step, from the label the server gave it ("Searching Instagram…", "Checking @x", "Reading @x’s recent posts…"). */
export function stageForLabel(label: string | null | undefined): Stage {
  if (!label) return 'thinking';
  if (label === LABEL_READING) return 'solving';
  if (/^searching/i.test(label)) return 'searching';
  if (/^(checking|reading @|looking)/i.test(label)) return 'walking';
  return 'thinking';
}
