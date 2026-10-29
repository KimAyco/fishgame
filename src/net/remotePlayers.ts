import Phaser from 'phaser';
import { Interpolator } from '../logic/interpolate';
import { txt } from '../ui/ui';
import { Dir } from '../world/mapgen';
import { drawRig, RigPhase } from '../world/rig';
import { net } from './NetClient';
import { EMOTE_GLYPH, PlayerState } from './protocol';

/** Drawn above everything in the world, below the HUD (which is on its own camera). */
const DEPTH_LABEL = 6000;

const hsl = (hue: number, s: number, l: number) => Phaser.Display.Color.HSLToColor(hue / 360, s, l);

/** A short line of text above a head (an emote or a chat message) that fades away. */
export class Bubble {
  private text: Phaser.GameObjects.Text | null = null;
  private until = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hideFromHud: (o: Phaser.GameObjects.GameObject) => void,
  ) {}

  show(message: string, nowMs: number, ms = 3500): void {
    if (!this.text) {
      this.text = txt(this.scene, 0, 0, '', 7, '#fff4d6', 0.5, 1).setDepth(DEPTH_LABEL + 1).setAlign('center');
      this.text.setWordWrapWidth(110);
      this.hideFromHud(this.text);
    }
    this.text.setText(message).setVisible(true).setAlpha(1);
    this.until = nowMs + ms;
  }

  /** Keeps the bubble over (x, y) and fades it out when its time is up. */
  place(x: number, y: number, nowMs: number): void {
    if (!this.text) return;
    const left = this.until - nowMs;
    if (left <= 0) {
      this.text.setVisible(false);
      return;
    }
    this.text.setPosition(Math.round(x), Math.round(y)).setAlpha(Math.min(1, left / 500));
  }

  destroy(): void {
    this.text?.destroy();
    this.text = null;
  }
}

interface Remote {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  bubble: Bubble;
  pos: Interpolator;
  bob: Interpolator;
  state: PlayerState;
  walkT: number;
  /** where it is drawn this frame */
  x: number;
  y: number;
  bobX: number;
  bobY: number;
}

/**
 * The other players in the room: a tinted copy of the player sprite for each, a name above it,
 * their fishing rod while they fish, and any emote or chat bubble. Positions arrive about 20
 * times a second and are smoothed (see Interpolator) so they glide instead of stepping.
 */
export class RemotePlayers {
  private remotes = new Map<string, Remote>();
  private unsub: (() => void)[] = [];

  /** `hideFromHud` must stop the HUD camera from drawing an object (world objects are not HUD). */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hideFromHud: (o: Phaser.GameObjects.GameObject) => void,
  ) {
    this.unsub.push(
      net.onEmote((id, e) => this.say(id, EMOTE_GLYPH[e] ?? '?', scene.time.now, 2500)),
      net.onChat((id, _name, text) => this.say(id, text, scene.time.now, 5000)),
    );
  }

  get count(): number {
    return this.remotes.size;
  }

  /** Position of a remote player as drawn, for anything that wants to point at them. */
  positionOf(id: string): { x: number; y: number } | null {
    const r = this.remotes.get(id);
    return r ? { x: r.x, y: r.y } : null;
  }

  private say(id: string, message: string, nowMs: number, ms: number): void {
    this.remotes.get(id)?.bubble.show(message, nowMs, ms);
  }

  /** Call once a frame: syncs with the room, then moves and animates every remote player. */
  update(nowMs: number, dt: number): void {
    const seen = new Set<string>();
    net.forEachRemote((id, p) => {
      seen.add(id);
      const r = this.remotes.get(id) ?? this.create(id, p);
      r.state = { x: p.x, y: p.y, dir: p.dir, moving: p.moving, name: p.name, hue: p.hue, state: p.state, bx: p.bx, by: p.by };
      r.pos.push(nowMs, p.x, p.y);
      r.bob.push(nowMs, p.bx, p.by);
    });
    for (const id of [...this.remotes.keys()]) if (!seen.has(id)) this.remove(id);

    for (const r of this.remotes.values()) {
      const at = r.pos.at(nowMs);
      if (at) {
        r.x = at.x;
        r.y = at.y;
      }
      const bob = r.bob.at(nowMs);
      if (bob) {
        r.bobX = bob.x;
        r.bobY = bob.y;
      }
      r.walkT = r.state.moving ? r.walkT + dt : 0;
      const frame = r.state.moving ? 1 + (Math.floor(r.walkT / 0.14) % 2) : 0;
      r.sprite.setTexture(`p_${r.state.dir}_${frame}`).setPosition(Math.round(r.x), Math.round(r.y)).setDepth(r.y);
      r.label.setPosition(Math.round(r.x), Math.round(r.y) - 24);
      r.bubble.place(r.x, r.y - 31, nowMs);
    }
  }

  /** Draws every remote player's rod, line and float into `g`. */
  draw(g: Phaser.GameObjects.Graphics, nowMs: number): void {
    for (const r of this.remotes.values()) {
      drawRig(g, { x: r.x, y: r.y, dir: r.state.dir as Dir, phase: r.state.state as RigPhase, lift: r.state.state === 'charging' ? 6 : 0, bobX: r.bobX, bobY: r.bobY }, nowMs);
    }
  }

  private create(id: string, p: PlayerState): Remote {
    const sprite = this.scene.add.image(p.x, p.y, 'p_down_0').setOrigin(0.5, 1).setTint(hsl(p.hue, 0.5, 0.84).color);
    const colour = hsl(p.hue, 0.7, 0.78);
    const hex = '#' + colour.color.toString(16).padStart(6, '0');
    const label = txt(this.scene, p.x, p.y - 24, p.name, 6, hex, 0.5, 1).setDepth(DEPTH_LABEL);
    this.hideFromHud(sprite);
    this.hideFromHud(label);
    const r: Remote = {
      sprite,
      label,
      bubble: new Bubble(this.scene, this.hideFromHud),
      pos: new Interpolator(),
      bob: new Interpolator(),
      state: p,
      walkT: 0,
      x: p.x,
      y: p.y,
      bobX: p.bx,
      bobY: p.by,
    };
    this.remotes.set(id, r);
    return r;
  }

  private remove(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.sprite.destroy();
    r.label.destroy();
    r.bubble.destroy();
    this.remotes.delete(id);
  }

  destroy(): void {
    for (const f of this.unsub) f();
    this.unsub = [];
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }
}
