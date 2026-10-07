import { describe, expect, it } from 'vitest';
import { PAYMENT_STATUSES } from './state';
import { INCOMING_VISIBLE, OUTGOING_VISIBLE, isVisibleInActivity } from './visibility';

describe('what shows in Activity', () => {
  it('never shows drafts, previews or cancelled/expired/rejected payments — they moved no money', () => {
    for (const s of ['DRAFT', 'PREVIEW', 'AWAITING_AUTHORIZATION', 'CANCELLED', 'EXPIRED', 'REJECTED'] as const) {
      expect(isVisibleInActivity(s, 'out')).toBe(false);
      expect(isVisibleInActivity(s, 'in')).toBe(false);
    }
  });

  it('shows what you sent once it is past the preview, including failures', () => {
    for (const s of ['AUTHORIZED', 'SIGNING', 'BROADCASTING', 'PENDING', 'CONFIRMED', 'FAILED'] as const) expect(isVisibleInActivity(s, 'out')).toBe(true);
  });

  it('shows money sent to you only once it is on its way or arrived — never the sender’s unfinished or failed attempts', () => {
    expect(isVisibleInActivity('CONFIRMED', 'in')).toBe(true);
    expect(isVisibleInActivity('PENDING', 'in')).toBe(true);
    for (const s of ['AUTHORIZED', 'PREPARING', 'SIGNING', 'FAILED'] as const) expect(isVisibleInActivity(s, 'in')).toBe(false);
  });

  it('only lists real statuses', () => {
    for (const s of [...OUTGOING_VISIBLE, ...INCOMING_VISIBLE]) expect(PAYMENT_STATUSES).toContain(s);
  });
});
