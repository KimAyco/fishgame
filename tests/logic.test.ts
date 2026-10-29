import { describe, expect, it } from 'vitest';
import { BAIT_BY_ID, ROD_BY_ID } from '../src/data/gear';
import { FISH_BY_ID } from '../src/data/fish';
import { MAPS } from '../src/data/maps';
import { buyBait, buyRod, consumeBait, defaultSave, fishPrice, levelOf, recordCatch, sellAll, unlockMap } from '../src/logic/economy';
import { biteDelay, newReel, reelQuality, rollFish, rollSize, stepReel, zoneAt } from '../src/logic/fishing';
import { mulberry32 } from '../src/logic/rng';
import { gameHour, timeOfDay } from '../src/logic/time';
import type { Rarity, ZoneDef } from '../src/types';

const ctx = { rod: ROD_BY_ID.stick, bait: BAIT_BY_ID.dough, time: 'day' as const, weather: 'clear' as const };

describe('data', () => {
  it('every zone references existing fish and covers power 0..1', () => {
    for (const map of MAPS) {
      for (const z of map.zones) for (const id of z.fish) expect(FISH_BY_ID[id], `${map.id}/${id}`).toBeDefined();
      expect(map.zones[0].from).toBe(0);
      expect(map.zones[map.zones.length - 1].to).toBeGreaterThan(1);
    }
  });
});

describe('rollFish', () => {
  const zone: ZoneDef = { id: 't', name: 't', from: 0, to: 1.01, fish: ['bluegill', 'carp', 'catfish', 'pike', 'goldkoi'] };

  it('respects rarity ordering', () => {
    const rng = mulberry32(1);
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < 30000; i++) counts[rollFish(rng, zone, ctx).rarity]++;
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.epic);
    expect(counts.epic).toBeGreaterThan(counts.legendary);
    expect(counts.legendary).toBeGreaterThan(0);
  });

  it('better bait raises the rare share', () => {
    const rare = (baitId: string) => {
      const rng = mulberry32(7);
      let n = 0;
      for (let i = 0; i < 20000; i++) {
        const r = rollFish(rng, zone, { ...ctx, bait: BAIT_BY_ID[baitId] }).rarity;
        if (r !== 'common' && r !== 'uncommon') n++;
      }
      return n;
    };
    expect(rare('glowfly')).toBeGreaterThan(rare('dough'));
  });

  it('time-of-day preference shifts odds', () => {
    const night = (time: 'day' | 'night') => {
      const rng = mulberry32(3);
      let n = 0;
      for (let i = 0; i < 20000; i++) if (rollFish(rng, zone, { ...ctx, time }).id === 'catfish') n++;
      return n;
    };
    expect(night('night')).toBeGreaterThan(night('day'));
  });
});

describe('sizes and prices', () => {
  it('rolls sizes within range', () => {
    const rng = mulberry32(5);
    for (const fish of Object.values(FISH_BY_ID)) {
      for (let i = 0; i < 50; i++) {
        const s = rollSize(rng, fish);
        expect(s).toBeGreaterThanOrEqual(fish.minSize);
        expect(s).toBeLessThanOrEqual(fish.maxSize);
      }
    }
  });

  it('bigger and better-fought fish are worth more', () => {
    const fish = FISH_BY_ID.bass;
    expect(fishPrice(fish, fish.maxSize, 0.5)).toBeGreaterThan(fishPrice(fish, fish.minSize, 0.5));
    expect(fishPrice(fish, 40, 1)).toBeGreaterThan(fishPrice(fish, 40, 0));
  });
});

describe('bite timing', () => {
  it('stays within bounds and faster gear shortens waits', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 200; i++) {
      const d = biteDelay(rng, ctx);
      expect(d).toBeGreaterThanOrEqual(2.5);
      expect(d).toBeLessThanOrEqual(9);
    }
    const slow = biteDelay(() => 0.5, ctx);
    const fast = biteDelay(() => 0.5, { ...ctx, rod: ROD_BY_ID.mythril, bait: BAIT_BY_ID.glowfly });
    expect(fast).toBeLessThan(slow);
  });
});

describe('reel minigame', () => {
  const fish = FISH_BY_ID.bass;

  it('wins when the bar tracks the fish', () => {
    const s = newReel();
    const rng = mulberry32(2);
    let status = 'ongoing';
    for (let i = 0; i < 60 * 30 && status === 'ongoing'; i++) {
      s.bar = Math.min(0.78, Math.max(0, s.fish - 0.11));
      status = stepReel(s, false, 1 / 60, fish, 0.22, rng);
    }
    expect(status).toBe('won');
    expect(reelQuality(s)).toBeGreaterThan(0.8);
  });

  it('loses when the bar is far from the fish', () => {
    const s = newReel();
    s.fish = 0.95;
    s.bar = 0;
    let status = 'ongoing';
    for (let i = 0; i < 60 * 30 && status === 'ongoing'; i++) status = stepReel(s, false, 1 / 60, fish, 0.22, () => 0.95);
    expect(status).toBe('lost');
  });
});

describe('economy', () => {
  it('records catches, tracks the book, and sells', () => {
    const d = defaultSave();
    const a = recordCatch(d, FISH_BY_ID.bluegill, 20, 1);
    expect(a.isNew).toBe(true);
    const b = recordCatch(d, FISH_BY_ID.bluegill, 24, 0.5);
    expect(b.isNew).toBe(false);
    expect(b.isRecord).toBe(true);
    expect(d.book.bluegill).toEqual({ count: 2, bestSize: 24 });
    const sold = sellAll(d);
    expect(sold.count).toBe(2);
    expect(d.coins).toBe(a.value + b.value);
    expect(d.inventory).toHaveLength(0);
  });

  it('levels with xp', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(25)).toBe(2);
    expect(levelOf(100)).toBe(3);
  });

  it('gates purchases and unlocks', () => {
    const d = defaultSave();
    expect(buyRod(d, ROD_BY_ID.bamboo).ok).toBe(false);
    d.coins = 1000;
    d.xp = 100;
    expect(buyRod(d, ROD_BY_ID.bamboo).ok).toBe(true);
    expect(d.rod).toBe('bamboo');
    expect(unlockMap(d, MAPS[1]).ok).toBe(true);
    expect(d.maps).toContain('river');
  });

  it('consumes bait and falls back to dough', () => {
    const d = defaultSave();
    d.coins = 100;
    buyBait(d, BAIT_BY_ID.worm);
    expect(d.bait.worm).toBe(5);
    for (let i = 0; i < 5; i++) expect(consumeBait(d).id).toBe('worm');
    expect(d.baitId).toBe('dough');
    expect(consumeBait(d).id).toBe('dough');
  });
});

describe('world', () => {
  it('maps cast power to zones', () => {
    expect(zoneAt(MAPS[0], 0.1).id).toBe('shallows');
    expect(zoneAt(MAPS[0], 1).id).toBe('deep');
  });

  it('cycles time of day', () => {
    expect(timeOfDay(gameHour(0))).toBe('dawn');
    expect(timeOfDay(23)).toBe('night');
    expect(timeOfDay(12)).toBe('day');
    expect(timeOfDay(19)).toBe('dusk');
  });
});
