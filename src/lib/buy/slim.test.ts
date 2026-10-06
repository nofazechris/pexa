import { describe, expect, it } from 'vitest';
import { slimForAgent } from './slim';

describe('slimForAgent', () => {
  it('keeps the signal and drops media / tracking noise', () => {
    const { output } = slimForAgent({ posts: [{ text: 'Celo is fast', author: 'amy', likes: 12, avatar_url: 'https://x/a.png', thumbnail: 'https://x/t.jpg', __typename: 'Post', cursor: 'abc' }] }, 6000) as { output: { posts: Array<Record<string, unknown>> } };
    expect(output.posts[0]).toEqual({ text: 'Celo is fast', author: 'amy', likes: 12 });
  });

  it('drops empty values and nested empties', () => {
    const { output } = slimForAgent({ a: null, b: '', c: [], d: { e: null }, f: 0, g: false }, 6000);
    expect(output).toEqual({ f: 0, g: false });
  });

  it('shortens long text and long lists, and says so', () => {
    const big = { items: Array.from({ length: 40 }, (_, i) => ({ id: i, text: 'x'.repeat(1000) })) };
    const { output, truncated } = slimForAgent(big, 6000);
    const s = JSON.stringify(output);
    expect(s.length).toBeLessThanOrEqual(6000);
    expect(truncated).toBe(true);
    expect(s).toContain('more not shown');
  });

  it('reports not truncated for a small payload and preserves the numbers', () => {
    const r = slimForAgent({ followers: 1520, verified: true, bio: 'Lagos • sneakers' }, 6000);
    expect(r.truncated).toBe(false);
    expect(r.output).toEqual({ followers: 1520, verified: true, bio: 'Lagos • sneakers' });
  });

  it('never exceeds the budget even for one giant string', () => {
    const { output } = slimForAgent('y'.repeat(50_000), 1000);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(1002);
  });
});

describe('slimForAgent output fields', () => {
  it('keeps program output (stdout) far longer than a social snippet', () => {
    const { output } = slimForAgent({ stdout: 'line\n'.repeat(300), caption: 'c'.repeat(1000) }, 6000) as { output: { stdout: string; caption: string } };
    expect(output.stdout.length).toBeGreaterThan(1000);
    expect(output.caption.length).toBeLessThanOrEqual(280);
  });

  it('keeps a plain-text result up to the budget', () => {
    const { output } = slimForAgent('z'.repeat(3000), 6000);
    expect((output as string).length).toBe(3000);
  });
});

import { parseMaybeJson, salvageTruncatedJson } from './slim';

describe('parseMaybeJson — gateway results that arrive as JSON text', () => {
  const data = { status: 'ok', timeline: [{ type: 'tweet', text: 'one', favorites: 5 }, { type: 'tweet', text: 'two', favorites: 9 }] };

  it('unwraps a JSON string, and a doubly-encoded one', () => {
    expect(parseMaybeJson(JSON.stringify(data))).toEqual(data);
    expect(parseMaybeJson(JSON.stringify(JSON.stringify(data)))).toEqual(data);
  });

  it('leaves real objects and ordinary text alone', () => {
    expect(parseMaybeJson(data)).toBe(data);
    expect(parseMaybeJson('hello world\nline two')).toBe('hello world\nline two');
    expect(parseMaybeJson('{not json')).toBe('{not json');
    expect(parseMaybeJson(null)).toBeNull();
  });

  it('recovers the complete items from a result that was cut off mid-way', () => {
    const full = JSON.stringify(data);
    const cut = full.slice(0, full.indexOf('"two"') + 3); // ends inside the second tweet's text
    expect(parseMaybeJson(cut)).toEqual({ status: 'ok', timeline: [{ type: 'tweet', text: 'one', favorites: 5 }] });
  });

  it('recovers from a cut-off, doubly-encoded result (what the X purchase actually stored)', () => {
    const stored = JSON.stringify(JSON.stringify(data)).slice(0, -30); // truncated inside the string literal
    const out = parseMaybeJson(stored) as { status: string; timeline: unknown[] };
    expect(out.status).toBe('ok');
    expect(out.timeline.length).toBeGreaterThanOrEqual(1);
  });

  it('salvage returns undefined when nothing complete exists', () => {
    expect(salvageTruncatedJson('{"a":')).toBeUndefined();
  });
});
