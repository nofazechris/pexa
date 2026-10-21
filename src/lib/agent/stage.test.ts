import { describe, expect, it } from 'vitest';
import { LABEL_READING, ORB_STATE, SOLVING, STAGE_LABEL, THINKING, stageForLabel, stageForTool } from './stage';

describe('stages come from what is really happening', () => {
  it('a research step is staged by what it is', () => {
    expect(stageForLabel('Searching Instagram for sneakers in Lagos')).toBe('searching');
    expect(stageForLabel('Searching TikTok for wigs in Abuja')).toBe('searching');
    expect(stageForLabel('Checking @kicks_one')).toBe('walking');
    expect(stageForLabel('Checking TikTok @tt_kicks')).toBe('walking');
    expect(stageForLabel('Reading @jet’s recent posts on X')).toBe('walking');
    expect(stageForLabel(LABEL_READING)).toBe('solving');
    expect(stageForLabel(null)).toBe('thinking');
    expect(stageForLabel('Working…')).toBe('thinking');
  });
  it('lookups are searching; saving and multi-step work is walking', () => {
    expect(stageForTool('research_yields').stage).toBe('searching');
    expect(stageForTool('buy_search_catalog').stage).toBe('searching');
    expect(stageForTool('get_earn_position').stage).toBe('searching');
    expect(stageForTool('find_contact').stage).toBe('searching');
    expect(stageForTool('watch_pool').stage).toBe('walking');
    expect(stageForTool('buy_purchase').stage).toBe('walking');
    expect(stageForTool('create_money_rule').stage).toBe('walking');
  });
  it('the model reading the question is thinking, and writing the answer is solving', () => {
    expect(THINKING.stage).toBe('thinking');
    expect(SOLVING.stage).toBe('solving');
  });
  it('every stage has an orb state and a label', () => {
    for (const s of ['thinking', 'searching', 'walking', 'solving'] as const) {
      expect(ORB_STATE[s]).toBeTruthy();
      expect(STAGE_LABEL[s]).toMatch(/…$/);
    }
    expect(Object.values(ORB_STATE)).toEqual(['breathing', 'searching', 'working', 'solving']);
  });
  it('every label the server can send ends in an ellipsis and names what is happening', () => {
    for (const n of ['research_yields', 'buy_search_catalog', 'buy_purchase', 'plan_research', 'get_earn_position', 'get_watchlist', 'check_deposit', 'get_statement', 'watch_pool', 'remember', 'whatever']) {
      expect(stageForTool(n).label).toMatch(/…$/);
    }
  });
});
