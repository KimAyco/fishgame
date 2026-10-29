import { describe, expect, it } from 'vitest';
import { FISH } from '../src/data/fish';
import { FISH_ART, FISH_PATTERNS, FISH_SHAPES } from '../src/data/fishArt';

describe('fish art', () => {
  it('has a spec for every species', () => {
    for (const fish of FISH) expect(FISH_ART[fish.id], fish.id).toBeDefined();
  });

  it('has no spec for an unknown species', () => {
    const ids = new Set(FISH.map((f) => f.id));
    for (const id of Object.keys(FISH_ART)) expect(ids.has(id), id).toBe(true);
  });

  it('uses valid shapes, patterns and colours', () => {
    for (const [id, art] of Object.entries(FISH_ART)) {
      expect(FISH_SHAPES, id).toContain(art.shape);
      expect(FISH_PATTERNS, id).toContain(art.pattern);
      for (const c of [art.back, art.flank, art.belly, art.fin, art.accent]) {
        expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff, `${id} colour ${c}`).toBe(true);
      }
    }
  });
});
