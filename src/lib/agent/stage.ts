/**
 * The four stages Pexa goes through while it works: thinking, searching, walking (going through things one by one) and solving
 * (putting an answer together). Each has an orb state and a plain label. Pure.
 *
 * The stage is never guessed from a timer. It comes from what is actually happening: the server reports each thing it starts —
 * a model call, a lookup, a step in a flow — and a research run reports its own steps.
 */

export type Stage = 'thinking' | 'searching' | 'walking' | 'solving';

/** What the server tells the browser it is doing right now. */
export interface StageEvent {
  stage: Stage;
  label: string;
}

/** The orb state each stage uses (what they look like: a calm ring, a dotted globe, scattered dots on the move, a converging sphere). */
export const ORB_STATE = { thinking: 'breathing', searching: 'searching', walking: 'working', solving: 'solving' } as const;

export const STAGE_LABEL: Record<Stage, string> = {
  thinking: 'Thinking…',
  searching: 'Looking things up…',
  walking: 'Working through it…',
  solving: 'Putting it together…',
};

/** The model is reading what the person said and deciding what to do. */
export const THINKING: StageEvent = { stage: 'thinking', label: 'Thinking about what you asked…' };
/** The model has what it looked up and is writing the answer. */
export const SOLVING: StageEvent = { stage: 'solving', label: 'Putting the answer together…' };

/** What a tool the agent is about to run means for the stage and what to call it. Lookups are "searching"; anything that works through steps or saves something is "walking". */
export function stageForTool(name: string): StageEvent {
  switch (name) {
    case 'research_yields':
      return { stage: 'searching', label: 'Reading live pool rates…' };
    case 'buy_search_catalog':
      return { stage: 'searching', label: 'Searching the Buy catalog…' };
    case 'buy_purchase':
      return { stage: 'walking', label: 'Preparing a Buy purchase…' };
    case 'plan_research':
      return { stage: 'walking', label: 'Planning the search…' };
    case 'get_earn_position':
      return { stage: 'searching', label: 'Reading your Aave balance on Celo…' };
    case 'get_watchlist':
      return { stage: 'searching', label: 'Reading your watchlist…' };
    case 'check_deposit':
      return { stage: 'searching', label: 'Checking the chain for your deposit…' };
    case 'get_statement':
    case 'get_recent_transactions':
      return { stage: 'searching', label: 'Collecting your payments…' };
    case 'watch_pool':
    case 'unwatch_pool':
      return { stage: 'walking', label: 'Saving that…' };
    case 'remember':
      return { stage: 'walking', label: 'Making a note…' };
    default:
      if (/^(find_|search_|get_|list_|read_|check_)/.test(name)) return { stage: 'searching', label: 'Looking that up…' };
      return { stage: 'walking', label: 'Working on it…' };
  }
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
