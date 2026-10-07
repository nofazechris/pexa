'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '@/lib/notifications/feed';

/**
 * The notification bar's data. Polls while the app is open (and when the tab comes back into view), keeps an unread
 * count for the bell, and tells the app when something worth a pop-up arrives — money in, a deposit, a request —
 * but only for things that appear AFTER the first load, so opening the app never replays old events as "new".
 */

const POLL_MS = 20_000;

export function useNotifications(getAccessToken: (() => Promise<string | null>) | undefined, onArrival?: (item: NotificationItem) => void) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const arrivalRef = useRef(onArrival);
  useEffect(() => {
    arrivalRef.current = onArrival;
  });

  const authed = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = getAccessToken ? await getAccessToken() : null;
      return fetch(url, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    },
    [getAccessToken],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await authed('/api/notifications');
      if (!res.ok) return;
      const data = (await res.json()) as { items: NotificationItem[]; unread: number };
      if (known.current === null) {
        known.current = new Set(data.items.map((i) => i.id)); // first look: nothing here is "just arrived"
      } else {
        for (const item of data.items) {
          if (known.current.has(item.id)) continue;
          known.current.add(item.id);
          if (item.highlight && item.unread) arrivalRef.current?.(item);
        }
      }
      setItems(data.items);
      setUnread(data.unread);
      setLoaded(true);
    } catch {
      /* the bar is a nicety — a failed poll just tries again later */
    }
  }, [authed]);

  /** The user opened the bar: everything so far is read. */
  const markSeen = useCallback(async () => {
    setUnread(0);
    try {
      await authed('/api/notifications/seen', { method: 'POST' });
    } catch {
      /* it will simply show as unread again on the next poll */
    }
  }, [authed]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { items, unread, loaded, refresh, markSeen };
}
