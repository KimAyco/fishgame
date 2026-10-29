import type Phaser from 'phaser';
import { Dir, DIRS } from './mapgen';

/** What an angler is doing. `result` (the catch popup) is drawn like idle. */
export type RigPhase = 'idle' | 'charging' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'result';

export interface Rig {
  /** feet position */
  x: number;
  y: number;
  dir: Dir;
  phase: RigPhase;
  /** how far the rod is raised for a cast, in pixels */
  lift: number;
  /** float position */
  bobX: number;
  bobY: number;
}

/** Where the tip of the rod is for an angler standing at (x, y). */
export function rodTipAt(x: number, y: number, dir: Dir, lift: number): { x: number; y: number } {
  const d = DIRS[dir];
  return { x: x + d.dx * 14, y: y - 13 + d.dy * 5 - lift };
}

/** Draws the rod, line and float. Used for the local player and for every remote player. */
export function drawRig(g: Phaser.GameObjects.Graphics, r: Rig, nowMs: number): void {
  if (r.phase === 'idle' || r.phase === 'result') return;

  const tip = rodTipAt(r.x, r.y, r.dir, r.lift);
  const d = DIRS[r.dir];
  g.lineStyle(2, 0x6b4a2a, 1);
  g.lineBetween(r.x + d.dx * 4, r.y - 9 + d.dy * 2, tip.x, tip.y);

  if (r.phase === 'charging') return;

  // line
  const sag = r.phase === 'reeling' ? 2 : 6;
  g.lineStyle(1, 0xffffff, 0.85);
  let lx = tip.x;
  let ly = tip.y;
  for (let i = 1; i <= 10; i++) {
    const u = i / 10;
    const x = tip.x + (r.bobX - tip.x) * u;
    const y = tip.y + (r.bobY - tip.y) * u + Math.sin(u * Math.PI) * sag;
    g.lineBetween(lx, ly, x, y);
    lx = x;
    ly = y;
  }

  // ripples and the float itself
  if (r.phase !== 'casting') {
    g.lineStyle(1, 0xffffff, 0.4);
    g.strokeEllipse(r.bobX, r.bobY + 2, 11 + Math.sin(nowMs / 300) * 2, 4);
  }
  g.fillStyle(0xe84a3c, 1);
  g.fillCircle(r.bobX, r.bobY, 2.5);
  g.fillStyle(0xffffff, 1);
  g.fillRect(r.bobX - 2, r.bobY - 0.5, 4, 1);
}
