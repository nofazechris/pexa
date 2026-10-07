'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui';
import { color } from '@/lib/design/tokens';
import type { NotificationItem, NotificationKind } from '@/lib/notifications/feed';

/**
 * The notification bar: a bell in the header with an unread badge, and a list of everything that happened — money
 * received, money sent, subscription payments, deposits, requests and purchases — newest first. Opening it marks
 * everything read, but the items that were new stay highlighted until it is closed so you can see what's new.
 */

const ICON: Record<NotificationKind, { glyph: string; bg: string; fg: string }> = {
  received: { glyph: '↓', bg: color.successSoft, fg: color.success },
  deposit: { glyph: '↓', bg: color.successSoft, fg: color.success },
  request_paid: { glyph: '✓', bg: color.successSoft, fg: color.success },
  sent: { glyph: '↑', bg: '#F1F2F5', fg: '#5B6472' },
  subscription: { glyph: '↻', bg: color.primarySoft, fg: color.primary },
  request: { glyph: '?', bg: '#FEFBF0', fg: color.warning },
  request_declined: { glyph: '×', bg: '#F1F2F5', fg: '#5B6472' },
  purchase: { glyph: '✦', bg: color.primarySoft, fg: color.primary },
  failed: { glyph: '!', bg: '#FDF1EF', fg: '#A8352A' },
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function NotificationBell({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
      style={{ position: 'relative', width: 34, height: 34, borderRadius: '50%', border: `1px solid ${color.borderStrong}`, background: color.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flex: 'none' }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 ? (
        <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999, background: color.primary, color: '#fff', fontSize: '10.5px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${color.background}`, lineHeight: 1 }}>
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </button>
  );
}

export function NotificationsPanel({
  open,
  onClose,
  items,
  onOpened,
  onGo,
}: {
  open: boolean;
  onClose: () => void;
  items: NotificationItem[];
  /** Called once when the panel opens (to mark everything read). */
  onOpened: () => void;
  onGo: (tab: NotificationItem['tab']) => void;
}) {
  // Remember which items were new when it opened, so they stay highlighted while it is open.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setFresh(new Set(items.filter((i) => i.unread).map((i) => i.id)));
      onOpened();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot only when opening, not on every poll
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} placement="bottom" title="Notifications" maxWidth={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '65dvh', overflowY: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ padding: '22px 4px', fontSize: '14px', color: color.mutedStrong, lineHeight: 1.55 }}>
            Nothing yet. When you receive money, make a payment, or a subscription payment goes out, it shows up here.
          </div>
        ) : null}
        {items.map((n) => {
          const ic = ICON[n.kind];
          const isNew = fresh.has(n.id);
          return (
            <button
              key={n.id}
              onClick={() => {
                onGo(n.tab);
                onClose();
              }}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', textAlign: 'left', border: 'none', background: isNew ? color.primarySoft : 'transparent', borderRadius: '12px', padding: '11px 10px', cursor: 'pointer', width: '100%' }}
            >
              <span style={{ width: 32, height: 32, borderRadius: '50%', background: ic.bg, color: ic.fg, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{ic.glyph}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: '14.5px', fontWeight: isNew ? 600 : 500, color: color.ink, letterSpacing: '-.01em' }}>{n.title}</span>
                {n.detail ? <span style={{ display: 'block', fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>{n.detail}</span> : null}
              </span>
              <span style={{ fontSize: '12px', color: color.faint, flex: 'none', marginTop: '2px' }}>{ago(n.at)}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
