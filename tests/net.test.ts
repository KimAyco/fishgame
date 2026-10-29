import { describe, expect, it } from 'vitest';
import { isClockSynced, syncClock, unsyncClock, worldMs } from '../src/logic/clock';
import { Interpolator, RENDER_DELAY_MS, SNAP_DISTANCE } from '../src/logic/interpolate';
import { cleanName, normalizeCode, roundPos, SendThrottle, toFishState } from '../src/net/protocol';

describe('world clock', () => {
  it('counts forward from page load while offline', () => {
    unsyncClock();
    expect(isClockSynced()).toBe(false);
    const a = worldMs(1_000_000);
    expect(worldMs(1_000_000 + 2500) - a).toBe(2500);
  });

  it('matches the server once synced, whatever the local clock says', () => {
    // server says it is 10_000 and its epoch is 4_000 => 6_000 ms of world time
    syncClock(10_000, 4_000, 2_000);
    expect(isClockSynced()).toBe(true);
    expect(worldMs(2_000)).toBe(6_000);
    expect(worldMs(3_500)).toBe(7_500);
    unsyncClock();
  });

  it('two machines with different clocks agree on world time', () => {
    const serverNow = 50_000_000;
    const epoch = 49_000_000;
    // machine A runs 5 s fast, machine B runs 3 s slow; both sync at "the same moment"
    syncClock(serverNow, epoch, serverNow + 5_000);
    const fromA = worldMs(serverNow + 5_000 + 1_000);
    syncClock(serverNow, epoch, serverNow - 3_000);
    const fromB = worldMs(serverNow - 3_000 + 1_000);
    expect(fromA).toBe(fromB);
    expect(fromA).toBe(serverNow - epoch + 1_000);
    unsyncClock();
  });
});

describe('Interpolator', () => {
  it('has no position until an update arrives', () => {
    expect(new Interpolator().at(1000)).toBeNull();
  });

  it('slides between two updates, drawn RENDER_DELAY_MS in the past', () => {
    const i = new Interpolator();
    i.push(1000, 0, 0);
    i.push(1100, 10, 20);
    const mid = i.at(1050 + RENDER_DELAY_MS)!;
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(10);
  });

  it('holds the latest position when no newer update has arrived', () => {
    const i = new Interpolator();
    i.push(0, 0, 0);
    i.push(100, 10, 0);
    expect(i.at(5000)).toEqual({ x: 10, y: 0 });
  });

  it('shows the first position before the delayed render time reaches it', () => {
    const i = new Interpolator();
    i.push(1000, 7, 8);
    expect(i.at(1000)).toEqual({ x: 7, y: 8 });
  });

  it('does not slide across a jump bigger than a walk', () => {
    const i = new Interpolator();
    i.push(0, 0, 0);
    i.push(100, SNAP_DISTANCE + 100, 0); // teleport
    const before = i.at(50 + RENDER_DELAY_MS)!;
    expect(before.x).toBe(0); // still at the old spot, not halfway there
    const after = i.at(100 + RENDER_DELAY_MS)!;
    expect(after.x).toBe(SNAP_DISTANCE + 100);
  });

  it('ignores repeats of the same position and keeps memory bounded', () => {
    const i = new Interpolator();
    for (let t = 0; t < 10_000; t += 50) i.push(t, t / 100, 0);
    i.push(10_000, 99.5, 0);
    i.push(10_050, 99.5, 0); // same place: dropped
    expect(i.at(20_000)).toEqual({ x: 99.5, y: 0 });
  });
});

describe('protocol helpers', () => {
  it('cleans display names the way the server does', () => {
    expect(cleanName('  <b>Ann</b>  ')).toBe('bAnn/b');
    expect(cleanName('a\u0007b​c')).toBe('abc');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName('  many   spaces  ')).toBe('many spaces');
    expect(cleanName('   ')).toBe('');
  });

  it('normalizes room codes', () => {
    expect(normalizeCode('  my room-1! ')).toBe('MYROOM1');
    expect(normalizeCode('abcdefghijklmnopqrstuvwxyz')).toHaveLength(12);
    expect(normalizeCode('')).toBe('');
  });

  it('maps scene phases to what other players are told', () => {
    for (const p of ['charging', 'casting', 'waiting', 'bite', 'reeling']) expect(toFishState(p)).toBe(p);
    expect(toFishState('result')).toBe('idle');
    expect(toFishState('idle')).toBe('idle');
    expect(toFishState('anything else')).toBe('idle');
  });

  it('rounds positions to a tenth of a pixel', () => {
    expect(roundPos(12.3456)).toBe(12.3);
    expect(roundPos(-0.04)).toBe(-0);
  });
});

describe('SendThrottle', () => {
  const same = (a: { x: number }, b: { x: number }) => a.x === b.x;

  it('sends the first value, then only changes, at most once per interval', () => {
    const t = new SendThrottle<{ x: number }>(100, same);
    expect(t.shouldSend({ x: 1 }, 0)).toBe(true);
    expect(t.shouldSend({ x: 2 }, 50)).toBe(false); // too soon
    expect(t.shouldSend({ x: 2 }, 100)).toBe(true);
    expect(t.shouldSend({ x: 2 }, 300)).toBe(false); // unchanged
    expect(t.shouldSend({ x: 3 }, 301)).toBe(true);
  });

  it('can be reset so the next value always goes out', () => {
    const t = new SendThrottle<{ x: number }>(100, same);
    expect(t.shouldSend({ x: 1 }, 0)).toBe(true);
    t.reset();
    expect(t.shouldSend({ x: 1 }, 1)).toBe(true);
  });
});
