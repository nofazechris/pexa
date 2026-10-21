'use client';

import { useEffect, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import { color } from '@/lib/design/tokens';
import { ORB_STATE, STAGE_LABEL, stageForWait, type Stage } from '@/lib/agent/stage';

/**
 * Pexa's working indicator: the thinking orb in place of a spinner. The orb reads the page's own `data-theme` attribute, so it
 * follows the app's light and dark themes by itself; it holds still for people who ask their device for reduced motion; and it
 * comes in the library's two tuned sizes — 64 (scaled down to `fit` pixels for a chat row) and 20 (inline with text).
 */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(q.matches);
    read();
    q.addEventListener('change', read);
    return () => q.removeEventListener('change', read);
  }, []);
  return reduced;
}

/** The orb for a stage. `size={20}` sits inline with text; `size={64}` is the chat scale, shrunk to `fit` px. */
export function AgentOrb({ stage, size = 20, fit }: { stage: Stage; size?: 20 | 64; fit?: number }) {
  const paused = useReducedMotion();
  const orb = <ThinkingOrb state={ORB_STATE[stage]} size={size} paused={paused} />;
  if (size === 64 && fit && fit !== 64) {
    return (
      <span style={{ display: 'inline-block', width: fit, height: fit, flex: 'none', overflow: 'visible', position: 'relative' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, width: 64, height: 64, transform: `scale(${fit / 64})`, transformOrigin: 'top left' }}>{orb}</span>
      </span>
    );
  }
  return <span style={{ display: 'inline-flex', flex: 'none', width: size, height: size }}>{orb}</span>;
}

/** How long something has been going on, in ms, ticking while `active` and back to zero when it stops. */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [active]);
  return active ? elapsed : 0;
}

/** The stage of a chat turn that is waiting for the agent, following how long it has been. */
export function useWaitStage(active: boolean): Stage {
  return stageForWait(useElapsed(active));
}

/** The chat row shown while the agent works: the orb and what stage it is in. */
export function ThinkingRow({ stage }: { stage: Stage }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', gap: '10px', alignItems: 'center', animation: 'pp-fade .2s ease both' }}>
      <AgentOrb stage={stage} size={64} fit={44} />
      <div style={{ border: `1px solid ${color.borderFaint}`, background: color.surface, borderRadius: '14px 14px 14px 4px', padding: '9px 13px', fontSize: '13.5px', color: color.mutedStrong }}>{STAGE_LABEL[stage]}</div>
    </div>
  );
}
