'use client';

import { useCallback, useMemo } from 'react';
import { useAuth } from './AuthProvider';
import type { ChatMessage } from './useAgentChat';

/**
 * Saved chats — the browser's side. Every call is best effort: a failure to save must never get in the way
 * of chatting, and a failure to load simply shows nothing.
 */

export interface ConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export function useConversations() {
  const { getAccessToken } = useAuth();

  const authed = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(url, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
    },
    [getAccessToken],
  );

  const list = useCallback(async (): Promise<ConversationSummary[]> => {
    try {
      const res = await authed('/api/conversations');
      if (!res.ok) return [];
      return ((await res.json()) as { conversations?: ConversationSummary[] }).conversations ?? [];
    } catch {
      return [];
    }
  }, [authed]);

  const load = useCallback(
    async (id: string): Promise<{ messages: ChatMessage[]; nextId: number } | null> => {
      try {
        const res = await authed(`/api/conversations/${id}`);
        if (!res.ok) return null;
        const data = (await res.json()) as { messages: ChatMessage[]; nextId: number };
        return { messages: data.messages, nextId: data.nextId };
      } catch {
        return null;
      }
    },
    [authed],
  );

  const save = useCallback(
    async (id: string, messages: ChatMessage[]): Promise<void> => {
      try {
        await authed(`/api/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ messages }) });
      } catch {
        /* best effort */
      }
    },
    [authed],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        return (await authed(`/api/conversations/${id}`, { method: 'DELETE' })).ok;
      } catch {
        return false;
      }
    },
    [authed],
  );

  return useMemo(() => ({ list, load, save, remove }), [list, load, save, remove]);
}
