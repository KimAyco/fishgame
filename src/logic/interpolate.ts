/**
 * Smooths another player's position. Updates arrive about 20 times a second, so drawing the
 * latest one directly looks jerky. Instead each update is stored with its arrival time and the
 * player is drawn a little in the past, interpolating between the two updates around that moment.
 */

export interface Sample {
  /** arrival time in ms */
  t: number;
  x: number;
  y: number;
  /** a jump (teleport, map change): do not slide across it */
  snap: boolean;
}

/** How far behind real time remote players are drawn; about two updates. */
export const RENDER_DELAY_MS = 100;
/** A move bigger than this between two updates is a jump, not a walk (walking is 62 px/s). */
export const SNAP_DISTANCE = 64;

const KEEP_MS = 1000;

export class Interpolator {
  private samples: Sample[] = [];

  /** Record the latest position as received at `t`. */
  push(t: number, x: number, y: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && last.x === x && last.y === y) return;
    const snap = !!last && Math.hypot(x - last.x, y - last.y) > SNAP_DISTANCE;
    this.samples.push({ t, x, y, snap });
    while (this.samples.length > 2 && this.samples[1].t < t - KEEP_MS) this.samples.shift();
  }

  /** Where to draw the player at time `now`. Null until the first update has arrived. */
  at(now: number): { x: number; y: number } | null {
    const s = this.samples;
    if (!s.length) return null;
    const when = now - RENDER_DELAY_MS;
    if (when <= s[0].t) return { x: s[0].x, y: s[0].y };
    for (let i = 1; i < s.length; i++) {
      if (when <= s[i].t) {
        const a = s[i - 1];
        const b = s[i];
        if (b.snap) return when < b.t ? { x: a.x, y: a.y } : { x: b.x, y: b.y };
        const k = (when - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    const last = s[s.length - 1];
    return { x: last.x, y: last.y };
  }

  clear(): void {
    this.samples = [];
  }
}
