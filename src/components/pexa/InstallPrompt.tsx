'use client';

import { useState, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui';
import { color } from '@/lib/design/tokens';
import { dismissNudge, getInstallKind, getNudgeAllowed, promptInstall, subscribeInstall, type InstallKind } from '@/lib/install';

/**
 * "Add Pexa to your home screen": a small, dismissible bar on phones, and a row in Settings that is always there.
 * Android installs with one tap when the browser allows it; iPhone has no such button, so we show the Share steps.
 */

export function useInstallKind(): InstallKind {
  return useSyncExternalStore(subscribeInstall, getInstallKind, () => 'none' as InstallKind);
}

function useNudgeAllowed(): boolean {
  return useSyncExternalStore(subscribeInstall, getNudgeAllowed, () => false);
}

/** What to do for each kind of phone, in plain steps. */
function Steps({ kind }: { kind: InstallKind }) {
  const steps =
    kind === 'ios'
      ? [
          'Tap the Share button (the square with an arrow pointing up) at the bottom of the screen.',
          'Scroll down and tap “Add to Home Screen”.',
          'Tap “Add”. Pexa now sits on your home screen like any other app.',
        ]
      : [
          'Tap the menu (three dots) in the top corner of your browser.',
          'Tap “Install app” or “Add to Home screen”.',
          'Tap “Install”. Pexa now sits on your home screen like any other app.',
        ];
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {steps.map((s, i) => (
        <li key={s} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: color.primarySoft, color: color.primary, fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{i + 1}</span>
          <span style={{ fontSize: '14.5px', lineHeight: 1.5, color: color.ink }}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallSteps({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: InstallKind }) {
  return (
    <Modal open={open} onClose={onClose} placement="bottom" title="Add Pexa to your home screen" maxWidth={460}>
      <Steps kind={kind} />
      {kind === 'ios' ? <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '14px', lineHeight: 1.5 }}>Using Chrome on iPhone? The Share button is next to the address bar. In Safari it is at the bottom.</div> : null}
    </Modal>
  );
}

/** Starts the install for this phone: the browser's own dialog on Android, the steps otherwise. */
function useInstallAction(kind: InstallKind) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const run = async () => {
    if (kind === 'prompt') {
      const installed = await promptInstall();
      if (!installed) dismissNudge();
      return;
    }
    setStepsOpen(true);
  };
  return { stepsOpen, closeSteps: () => setStepsOpen(false), run };
}

/** The bar on top of the app (phones only). */
export function InstallBanner() {
  const kind = useInstallKind();
  const allowed = useNudgeAllowed();
  const { stepsOpen, closeSteps, run } = useInstallAction(kind);
  if (kind === 'installed' || kind === 'none' || !allowed) return null;
  return (
    <>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px clamp(14px,2.6vw,26px)', background: color.primarySoft, borderBottom: `1px solid ${color.primarySoftBorder}` }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 600, color: color.ink, letterSpacing: '-.01em' }}>Add Pexa to your home screen</div>
          <div style={{ fontSize: '12px', color: color.mutedStrong, marginTop: '1px' }}>Opens like an app, one tap away.</div>
        </div>
        <button onClick={() => void run()} style={{ border: 'none', background: color.primary, color: '#fff', fontSize: '13px', fontWeight: 500, padding: '7px 13px', borderRadius: '999px', cursor: 'pointer', flex: 'none' }}>
          {kind === 'prompt' ? 'Install' : 'Show me how'}
        </button>
        <button onClick={dismissNudge} aria-label="Not now" style={{ border: 'none', background: 'transparent', color: color.mutedStrong, fontSize: '20px', lineHeight: 1, padding: '2px 4px', cursor: 'pointer', flex: 'none' }}>
          ×
        </button>
      </div>
      <InstallSteps open={stepsOpen} onClose={closeSteps} kind={kind} />
    </>
  );
}

/** The always-available row in Settings (phones only; hidden once installed). */
export function InstallSetting() {
  const kind = useInstallKind();
  const { stepsOpen, closeSteps, run } = useInstallAction(kind);
  if (kind === 'installed' || kind === 'none') return null;
  return (
    <section>
      <div style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: '16px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-.015em' }}>Add to home screen</div>
          <div style={{ fontSize: '12.5px', color: color.mutedStrong, marginTop: '2px' }}>Open Pexa like an app, without the browser bars.</div>
        </div>
        <button onClick={() => void run()} style={{ border: `1px solid ${color.borderStrong}`, background: color.surface, color: color.ink, fontSize: '13px', fontWeight: 500, padding: '8px 13px', borderRadius: '10px', cursor: 'pointer', flex: 'none' }}>
          {kind === 'prompt' ? 'Install' : 'Show me how'}
        </button>
      </div>
      <InstallSteps open={stepsOpen} onClose={closeSteps} kind={kind} />
    </section>
  );
}
