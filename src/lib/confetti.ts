/**
 * Confetti — a small, dependency-free celebration for the moment someone joins the waitlist.
 *
 * Two cannons fire from the bottom corners, then a lighter second wave follows, and the pieces fall
 * with gravity and fade out; the whole thing removes itself in about four seconds. It draws on its own
 * full-screen canvas that ignores pointer events, so it never blocks the page. It is skipped entirely
 * for people who have asked their device to reduce motion. The physics is pure (below) so it can be
 * unit-tested; only {@link fireConfetti} touches the DOM.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  shape: 'rect' | 'circle';
  life: number;
  maxLife: number;
}

/** On-brand cobalts plus a few warm/celebratory accents (all readable on the light page). */
export const CONFETTI_COLORS = ['#1B45D7', '#3D66F0', '#9FB4F0', '#3FBF85', '#F5B83D', '#FF7A59', '#B266F0'];

export const GRAVITY = 0.34;
export const DRAG = 0.992;

/**
 * A burst of particles from (x, y), fired around `angleDeg` (canvas coordinates: 0° = right,
 * -90° = straight up) and fanned out by ±`spread/2` degrees. `rng` is injectable for tests.
 */
export function spawnBurst(opts: { x: number; y: number; angleDeg: number; spread: number; count: number; rng?: () => number }): Particle[] {
  const rng = opts.rng ?? Math.random;
  return Array.from({ length: opts.count }, () => {
    const angle = ((opts.angleDeg + (rng() - 0.5) * opts.spread) * Math.PI) / 180;
    const speed = 9 + rng() * 9;
    const maxLife = 150 + Math.floor(rng() * 70);
    return {
      x: opts.x,
      y: opts.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 6 + rng() * 6,
      color: CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)],
      rot: rng() * Math.PI * 2,
      vr: (rng() - 0.5) * 0.4,
      shape: rng() < 0.7 ? 'rect' : 'circle',
      life: 0,
      maxLife,
    };
  });
}

/** Advance one particle by one frame (mutates): drag, gravity, motion, spin, age. */
export function stepParticle(p: Particle): void {
  p.vx *= DRAG;
  p.vy = p.vy * DRAG + GRAVITY;
  p.x += p.vx;
  p.y += p.vy;
  p.rot += p.vr;
  p.life += 1;
}

/** Still worth drawing: not expired and not fallen well below the screen. */
export function isAlive(p: Particle, height: number): boolean {
  return p.life < p.maxLife && p.y < height + 60;
}

/** 1 while young, easing to 0 over the last quarter of its life (the fade-out). */
export function particleOpacity(p: Particle): number {
  const fadeStart = p.maxLife * 0.75;
  return p.life <= fadeStart ? 1 : Math.max(0, 1 - (p.life - fadeStart) / (p.maxLife - fadeStart));
}

let running = false;

/** Fire the celebration. Safe to call repeatedly (a running one isn't stacked) and on the server (no-op). */
export function fireConfetti(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || running) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2147483000' });
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);
  running = true;

  // Fewer pieces on small screens, where the cannons sit closer together.
  const big = width >= 700;
  const count = big ? 110 : 70;
  const particles: Particle[] = [
    ...spawnBurst({ x: 0, y: height, angleDeg: -58, spread: 40, count }),
    ...spawnBurst({ x: width, y: height, angleDeg: -122, spread: 40, count }),
  ];
  // A lighter second wave a moment later keeps the celebration going.
  const secondWave = setTimeout(() => {
    particles.push(
      ...spawnBurst({ x: width * 0.25, y: height, angleDeg: -75, spread: 50, count: Math.round(count / 2) }),
      ...spawnBurst({ x: width * 0.75, y: height, angleDeg: -105, spread: 50, count: Math.round(count / 2) }),
    );
  }, 320);

  const startedAt = performance.now();
  const frame = (now: number) => {
    ctx.clearRect(0, 0, width, height);
    let alive = 0;
    for (const p of particles) {
      if (!isAlive(p, height)) continue;
      stepParticle(p);
      alive++;
      ctx.save();
      ctx.globalAlpha = particleOpacity(p);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // Stop when everything's gone (after the second wave had its chance) or after a hard time limit.
    if ((alive === 0 && now - startedAt > 400) || now - startedAt > 6000) {
      clearTimeout(secondWave);
      canvas.remove();
      running = false;
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
