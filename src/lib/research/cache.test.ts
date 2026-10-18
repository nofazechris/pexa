import { describe, expect, it } from 'vitest';
import { SERVICE, freshForMs } from './engine';

describe('how long a bought answer is reused', () => {
  it('profiles last longer than searches, and recent posts the shortest', () => {
    expect(freshForMs(SERVICE.igProfile)).toBeGreaterThan(freshForMs(SERVICE.igSearch));
    expect(freshForMs(SERVICE.igSearch)).toBeGreaterThan(freshForMs(SERVICE.xTimeline));
    expect(freshForMs(SERVICE.xTimeline)).toBeGreaterThan(0);
  });
  it('never reuses anything outside the research allow-list', () => {
    expect(freshForMs('some.other.service')).toBe(0);
  });
});
