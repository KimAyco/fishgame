import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/data/maps';
import { DIRS, exitGeometry, generateMap, isSolid, isWater, T } from '../src/world/mapgen';

function reachable(m: ReturnType<typeof generateMap>, sx: number, sy: number): Set<string> {
  const seen = new Set<string>([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      if (isSolid(m.tiles[ny][nx]) || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      q.push([nx, ny]);
    }
  }
  return seen;
}

describe.each(MAPS.map((m) => [m.id, m] as const))('mapgen %s', (_id, def) => {
  const m = generateMap(def);

  it('is deterministic', () => {
    expect(generateMap(def).tiles).toEqual(m.tiles);
  });

  it('spawns on walkable ground facing water within casting range', () => {
    expect(isSolid(m.tiles[m.spawn.y][m.spawn.x])).toBe(false);
    const d = DIRS[m.spawn.dir];
    let found = -1;
    for (let i = 1; i <= 8 && found < 0; i++) if (isWater(m.tiles[m.spawn.y + d.dy * i]?.[m.spawn.x + d.dx * i])) found = i;
    expect(found).toBeGreaterThan(0);
    expect(found).toBeLessThanOrEqual(2);
  });

  it('has both shallow and deep water', () => {
    const flat = m.tiles.flat();
    expect(flat).toContain(T.WATER);
    expect(flat).toContain(T.DEEP);
  });

  it('connects spawn, shop door and every exit', () => {
    const seen = reachable(m, m.spawn.x, m.spawn.y);
    expect(seen.has(`${m.shop.front.x},${m.shop.front.y}`)).toBe(true);
    for (const e of m.exits) {
      for (const t of e.tiles) expect(seen.has(`${t.x},${t.y}`), `${e.side} ${t.x},${t.y}`).toBe(true);
      expect(seen.has(`${e.inner.x},${e.inner.y}`)).toBe(true);
    }
  });

  it('has a shop door facing the walkable front tile', () => {
    expect(m.tiles[m.shop.y + 1][m.shop.x + 1]).toBe(T.DOOR);
    expect(m.tiles[m.shop.front.y][m.shop.front.x]).not.toBe(T.DOOR);
  });
});

describe('exits', () => {
  it('every exit has a matching return exit', () => {
    for (const def of MAPS) {
      for (const e of def.exits) {
        const target = MAPS.find((m) => m.id === e.to)!;
        expect(target.exits.some((x) => x.to === def.id), `${def.id}->${e.to}`).toBe(true);
        expect(exitGeometry(def.size.w, def.size.h, e.side).tiles).toHaveLength(3);
      }
    }
  });
});
