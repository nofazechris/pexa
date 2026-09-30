import { describe, expect, it } from 'vitest';
import { CONFETTI_COLORS, GRAVITY, isAlive, particleOpacity, spawnBurst, stepParticle, fireConfetti } from './confetti';

// A tiny deterministic RNG so the tests are repeatable.
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('spawnBurst', () => {
  it('creates the requested number of particles at the origin, all on-palette', () => {
    const ps = spawnBurst({ x: 10, y: 500, angleDeg: -60, spread: 40, count: 50, rng: seeded(1) });
    expect(ps).toHaveLength(50);
    for (const p of ps) {
      expect(p.x).toBe(10);
      expect(p.y).toBe(500);
      expect(CONFETTI_COLORS).toContain(p.color);
      expect(p.life).toBe(0);
    }
  });

  it('fires upward-and-inward from the left cannon (right = +x, up = -y)', () => {
    const ps = spawnBurst({ x: 0, y: 500, angleDeg: -58, spread: 40, count: 200, rng: seeded(2) });
    for (const p of ps) {
      expect(p.vx).toBeGreaterThan(0); // toward the screen's middle
      expect(p.vy).toBeLessThan(0); // upward
    }
  });

  it('mirrors correctly for the right cannon', () => {
    const ps = spawnBurst({ x: 800, y: 500, angleDeg: -122, spread: 40, count: 200, rng: seeded(3) });
    for (const p of ps) {
      expect(p.vx).toBeLessThan(0);
      expect(p.vy).toBeLessThan(0);
    }
  });
});

describe('stepParticle', () => {
  it('gravity eventually pulls a rising piece back down', () => {
    const [p] = spawnBurst({ x: 0, y: 500, angleDeg: -90, spread: 0, count: 1, rng: seeded(4) });
    expect(p.vy).toBeLessThan(0);
    let flipped = false;
    for (let i = 0; i < 120 && !flipped; i++) {
      stepParticle(p);
      flipped = p.vy > 0;
    }
    expect(flipped).toBe(true);
    expect(GRAVITY).toBeGreaterThan(0);
  });

  it('ages the particle each frame', () => {
    const [p] = spawnBurst({ x: 0, y: 0, angleDeg: -90, spread: 0, count: 1, rng: seeded(5) });
    stepParticle(p);
    stepParticle(p);
    expect(p.life).toBe(2);
  });
});

describe('lifetime', () => {
  const base = spawnBurst({ x: 0, y: 0, angleDeg: -90, spread: 0, count: 1, rng: seeded(6) })[0];

  it('stays fully opaque while young and fades to nothing at the end', () => {
    expect(particleOpacity({ ...base, life: 0 })).toBe(1);
    expect(particleOpacity({ ...base, life: base.maxLife * 0.5 })).toBe(1);
    const mid = particleOpacity({ ...base, life: base.maxLife * 0.9 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(particleOpacity({ ...base, life: base.maxLife })).toBe(0);
  });

  it('dies when expired or once it has fallen well off the bottom of the screen', () => {
    expect(isAlive({ ...base, life: 0, y: 100 }, 800)).toBe(true);
    expect(isAlive({ ...base, life: base.maxLife, y: 100 }, 800)).toBe(false);
    expect(isAlive({ ...base, life: 0, y: 900 }, 800)).toBe(false);
  });
});

describe('fireConfetti', () => {
  it('is a harmless no-op outside a browser (server rendering / tests)', () => {
    expect(() => fireConfetti()).not.toThrow();
  });
});
