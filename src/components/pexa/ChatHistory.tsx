'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/components/ui';
import { color } from '@/lib/design/tokens';
import type { ConversationSummary } from '@/components/auth/useConversations';

/**
 * Past chats: a list you can reopen (to carry on exactly where you left off) or delete, plus the small
 * "Continue" card shown on an empty chat. Everything is saved automatically — there is nothing to remember to do.
 */

export interface ConversationsApi {
  list: () => Promise<ConversationSummary[]>;
  remove: (id: string) => Promise<boolean>;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function HistorySheet({
  open,
  onClose,
  api,
  currentId,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  api: ConversationsApi;
  currentId: string | null;
  onOpen: (id: string) => Promise<boolean>;
}) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await api.list());
  }, [api]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setItems(null);
      setFailed(false);
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [open, refresh]);

  const openOne = async (id: string) => {
    setBusy(id);
    setFailed(false);
    const ok = await onOpen(id);
    setBusy(null);
    if (ok) onClose();
    else setFailed(true);
  };

  const removeOne = async (id: string) => {
    setBusy(id);
    const ok = await api.remove(id);
    setBusy(null);
    if (ok) setItems((prev) => (prev ?? []).filter((c) => c.id !== id));
  };

  return (
    <Modal open={open} onClose={onClose} placement="bottom" title="Chat history" maxWidth={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60dvh', overflowY: 'auto' }}>
        {items === null ? <div style={{ padding: '18px 4px', fontSize: '14px', color: color.mutedStrong }}>Loading…</div> : null}
        {items && items.length === 0 ? (
          <div style={{ padding: '18px 4px', fontSize: '14px', color: color.mutedStrong, lineHeight: 1.5 }}>No saved chats yet. Your conversations are saved automatically as you go.</div>
        ) : null}
        {items?.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: `1px solid ${c.id === currentId ? color.primary : color.border}`, background: c.id === currentId ? color.primarySoft : color.surface, borderRadius: '13px' }}>
            <button
              onClick={() => void openOne(c.id)}
              disabled={busy === c.id}
              style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', padding: '12px 13px', cursor: 'pointer' }}
            >
              <div style={{ fontSize: '14.5px', fontWeight: 500, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
              <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '3px' }}>
                {ago(c.updatedAt)} · {c.messageCount} messages{c.id === currentId ? ' · open now' : ''}
              </div>
            </button>
            <button
              onClick={() => void removeOne(c.id)}
              disabled={busy === c.id}
              aria-label={`Delete chat: ${c.title}`}
              style={{ flex: 'none', border: 'none', background: 'transparent', color: color.faint, fontSize: '12.5px', padding: '12px 13px', cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        ))}
        {failed ? <div style={{ fontSize: '13px', color: color.danger, padding: '4px 2px' }}>Couldn’t open that chat. Please try again.</div> : null}
      </div>
    </Modal>
  );
}

/** Shown on an empty chat: pick up the last conversation in one tap. */
export function ContinueCard({ api, onOpen }: { api: ConversationsApi; onOpen: (id: string) => Promise<boolean> }) {
  const [last, setLast] = useState<ConversationSummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.list().then((all) => {
      if (alive) setLast(all[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, [api]);

  if (!last) return null;
  return (
    <button
      onClick={async () => {
        setBusy(true);
        const ok = await onOpen(last.id);
        if (!ok) setBusy(false);
      }}
      disabled={busy}
      style={{ marginTop: '14px', maxWidth: '430px', width: '100%', textAlign: 'left', border: `1px solid ${color.primarySoftBorder}`, background: color.primarySoft, borderRadius: '13px', padding: '12px 14px', cursor: 'pointer' }}
    >
      <div style={{ fontFamily: 'var(--font-geist-mono),monospace', fontSize: '10.5px', letterSpacing: '.12em', color: color.primaryHover }}>CONTINUE WHERE YOU LEFT OFF</div>
      <div style={{ fontSize: '14.5px', fontWeight: 500, color: color.ink, marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{last.title}</div>
      <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '2px' }}>{ago(last.updatedAt)}</div>
    </button>
  );
}
