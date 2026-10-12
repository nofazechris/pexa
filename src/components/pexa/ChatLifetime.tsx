'use client';

import { color } from '@/lib/design/tokens';
import { lifetimeNote } from '@/lib/conversations/lifetime';

/**
 * The line at the top of a chat: chats close 7 days after they start. Once closed, a chat can still be read, and one tap
 * starts a new chat that carries over where it left off.
 */
export function ChatLifetimeBanner({ closesAt, closed, onContinue }: { closesAt: string | null; closed: boolean; onContinue: () => void }) {
  const text = lifetimeNote({ closesAtIso: closesAt, closed });
  if (closed) {
    return (
      <div role="status" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '10px clamp(14px,2.6vw,26px) 0', padding: '10px 12px', borderRadius: '12px', border: `1px solid ${color.warningBorder}`, background: color.warningTint }}>
        <span style={{ flex: 1, minWidth: '200px', fontSize: '12.5px', lineHeight: 1.5, color: color.mutedStrong }}>{text}</span>
        <button onClick={onContinue} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '13px', fontWeight: 500, padding: 'var(--pp-btn-y) 14px', borderRadius: '10px', cursor: 'pointer', flex: 'none' }}>
          Continue in a new chat
        </button>
      </div>
    );
  }
  return (
    <div role="note" style={{ flex: 'none', margin: '8px clamp(14px,2.6vw,26px) 0', fontSize: '11.5px', lineHeight: 1.45, color: color.faint, textAlign: 'center' }}>
      {text}
    </div>
  );
}
