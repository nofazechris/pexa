import { describe, expect, it } from 'vitest';
import { LABEL_READING, ORB_STATE, STAGE_LABEL, stageForLabel, stageForWait } from './stage';

describe('stages while Pexa works', () => {
  it('a chat wait moves through thinking, searching, walking, solving', () => {
    expect([0, 2_999, 3_000, 7_999, 8_000, 13_999, 14_000, 60_000].map(stageForWait)).toEqual(['thinking', 'thinking', 'searching', 'searching', 'walking', 'walking', 'solving', 'solving']);
  });
  it('a research step is staged by what it really is', () => {
    expect(stageForLabel('Searching Instagram for sneakers in Lagos')).toBe('searching');
    expect(stageForLabel('Searching TikTok for wigs in Abuja')).toBe('searching');
    expect(stageForLabel('Checking @kicks_one')).toBe('walking');
    expect(stageForLabel('Checking TikTok @tt_kicks')).toBe('walking');
    expect(stageForLabel('Reading @jet’s recent posts on X')).toBe('walking');
    expect(stageForLabel(LABEL_READING)).toBe('solving');
    expect(stageForLabel(null)).toBe('thinking');
    expect(stageForLabel('Working…')).toBe('thinking');
  });
  it('every stage has an orb state and a label', () => {
    for (const s of ['thinking', 'searching', 'walking', 'solving'] as const) {
      expect(ORB_STATE[s]).toBeTruthy();
      expect(STAGE_LABEL[s]).toMatch(/…$/);
    }
    expect(Object.values(ORB_STATE)).toEqual(['breathing', 'searching', 'working', 'solving']);
  });
});
