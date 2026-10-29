import Phaser from 'phaser';
import { BAIT_BY_ID } from '../data/gear';
import { MAP_BY_ID } from '../data/maps';
import { consumeBait, currentRod, levelOf, recordCatch, xpForLevel } from '../logic/economy';
import {
  biteDelay,
  FishContext,
  HOOK_WINDOW,
  newReel,
  ReelState,
  reelQuality,
  rollFish,
  rollSize,
  stepReel,
  zoneForDepth,
} from '../logic/fishing';
import { defaultRng } from '../logic/rng';
import { gameHour, timeOfDay, weatherAt } from '../logic/time';
import { persist, session, store } from '../save/storage';
import type { FishDef, MapDef, ZoneDef } from '../types';
import { lerpColor, nightFactor, RARITY_COLOR, txt } from '../ui/ui';
import { ensureTextures, WATER_FRAMES } from '../world/art';
import { ensureFishSprites } from '../world/fishart';
import { worldMs } from '../logic/clock';
import { net } from '../net/NetClient';
import { getCode, getName, getOnline } from '../net/prefs';
import { EMOTE_GLYPH, FISH_INTERVAL_MS, FishPayload, MOVE_INTERVAL_MS, MovePayload, roundPos, SendThrottle, toFishState } from '../net/protocol';
import { Bubble, RemotePlayers } from '../net/remotePlayers';
import { drawRig, rodTipAt } from '../world/rig';
import { Dir, DIRS, GeneratedMap, generateMap, isSolid, isWater, T, TILE } from '../world/mapgen';

type Phase = 'idle' | 'charging' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'result';

const SPEED = 62;
const CAST_TIME = 0.5;
const MAX_REACH = 8;
const TRACK = { y: 40, w: 12, h: 120 };
const DEPTH_WORLD_FX = 5000;
const DEPTH_SCREEN_FX = 8000;
const DEPTH_UI = 9000;

export class FishingScene extends Phaser.Scene {
  private map!: MapDef;
  private gen!: GeneratedMap;
  private arriveFrom?: string;

  private player!: Phaser.GameObjects.Image;
  private dir: Dir = 'down';
  private px = 0;
  private py = 0;
  private walkT = 0;
  private moving = false;

  private waterImgs: { img: Phaser.GameObjects.Image; key: string; ph: number }[] = [];
  private waterTick = 0;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private space!: Phaser.Input.Keyboard.Key;
  private pointerHeld = false;
  private prevHeld = false;

  private wg!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;

  private phase: Phase = 'idle';
  private power = 0;
  private powerDir = 1;
  private castT = 0;
  private target = { tx: 0, ty: 0, deep: false };
  private zone!: ZoneDef;
  private biteTimer = 0;
  private hookTimer = 0;
  private hooked: FishDef | null = null;
  private reel: ReelState = newReel();
  private bobber = { x: 0, y: 0 };
  private drops: { x: number; y: number; v: number }[] = [];
  private popup: Phaser.GameObjects.GameObject[] = [];
  private uiCam?: Phaser.Cameras.Scene2D.Camera;
  /** logical screen size in game pixels, and the integer zoom that maps it to the canvas */
  private vw = 400;
  private vh = 225;
  private hudObjs: Phaser.GameObjects.GameObject[] = [];
  private netText!: Phaser.GameObjects.Text;
  private remotes?: RemotePlayers;
  private selfBubble?: Bubble;
  private netUnsubs: (() => void)[] = [];
  private chatInput: HTMLInputElement | null = null;
  private moveThrottle = new SendThrottle<MovePayload>(MOVE_INTERVAL_MS, (a, b) => a.x === b.x && a.y === b.y && a.dir === b.dir && a.moving === b.moving);
  private fishThrottle = new SendThrottle<FishPayload>(FISH_INTERVAL_MS, (a, b) => a.state === b.state && a.bx === b.bx && a.by === b.by);
  private popupReadyAt = 0;
  private debug = false;
  private exitCooldown = 0;

  private hudTop!: Phaser.GameObjects.Text;
  private hudBottom!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private alert!: Phaser.GameObjects.Text;
  private zoneLabel!: Phaser.GameObjects.Text;
  private debugText!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private toastUntil = 0;

  constructor() {
    super('Fishing');
  }

  init(data: { mapId?: string; from?: string }): void {
    this.map = MAP_BY_ID[data.mapId ?? store.data.lastMap] ?? MAP_BY_ID.pond;
    this.arriveFrom = data.from;
  }

  // ---- setup --------------------------------------------------------------

  create(): void {
    this.uiCam = undefined;
    this.layout();
    ensureTextures(this, this.map);
    ensureFishSprites(this);
    this.gen = generateMap(this.map);
    store.data.lastMap = this.map.id;
    persist();

    this.phase = 'idle';
    this.power = 0;
    this.prevHeld = false;
    this.pointerHeld = false;
    this.hooked = null;
    this.popup = [];
    this.debug = false;
    this.moving = false;
    this.exitCooldown = 0.6;
    this.waterImgs = [];
    this.waterTick = 0;
    this.drops = Array.from({ length: 60 }, () => ({ x: Math.random() * this.vw, y: Math.random() * this.vh, v: 120 + Math.random() * 80 }));

    this.buildWorld();
    this.placePlayer();

    this.wg = this.add.graphics().setDepth(DEPTH_WORLD_FX);
    this.alert = txt(this, 0, 0, '!', 14, '#ffef5a', 0.5, 1).setDepth(DEPTH_WORLD_FX + 1).setVisible(false);
    this.zoneLabel = txt(this, 0, 0, '', 7, '#ffffff', 0.5, 1).setDepth(DEPTH_WORLD_FX + 1).setVisible(false);

    // Everything above is world content. The HUD below lives on its own camera so it is not
    // scrolled with the player, and is drawn at 1:1 canvas scale for crisp text.
    const worldObjs = this.children.list.slice();
    this.fx = this.add.graphics().setDepth(DEPTH_SCREEN_FX);
    this.ui = this.add.graphics().setDepth(DEPTH_UI);
    const hud = (t: Phaser.GameObjects.Text) => t.setDepth(DEPTH_UI + 1);
    this.hudTop = hud(txt(this, 6, 4, '', 8));
    this.hudBottom = hud(txt(this, 6, 14, '', 7, '#c8d0d8'));
    this.hint = hud(txt(this, this.vw / 2, this.vh - 4, '', 7, '#ffffff', 0.5, 1));
    this.debugText = hud(txt(this, 6, 28, '', 7, '#9aff9a')).setVisible(false);
    this.toast = hud(txt(this, this.vw / 2, 34, '', 9, '#ffffff', 0.5, 0)).setVisible(false);
    this.netText = hud(txt(this, this.vw - 6, 4, '', 7, '#cdb98f', 1, 0));
    this.hudObjs = [this.fx, this.ui, this.hudTop, this.hudBottom, this.hint, this.debugText, this.toast, this.netText];

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.ignore(worldObjs);
    this.layout();
    this.cameras.main.ignore(this.hudObjs);
    this.setupNet();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.gen.w * TILE, this.gen.h * TILE);
    cam.startFollow(this.player, true, 0.2, 0.2);
    cam.setRoundPixels(true);
    cam.centerOn(this.px, this.py);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys('W,A,S,D') as typeof this.wasd;
    this.space = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    kb.on('keydown-B', this.cycleBait, this);
    kb.on('keydown-M', this.openMap, this);
    kb.on('keydown-ESC', this.openMap, this);
    kb.on('keydown-F', this.openBook, this);
    kb.on('keydown-F3', this.toggleDebug, this);
    kb.on('keydown', this.onKeyDown, this);

    this.scale.on('resize', this.layout, this);
    this.input.on('pointerdown', () => (this.pointerHeld = true));
    this.input.on('pointerup', () => (this.pointerHeld = false));

    this.time.addEvent({
      delay: 130,
      loop: true,
      callback: () => {
        this.waterTick++;
        const v = this.cameras.main.worldView;
        const x0 = v.x - TILE;
        const x1 = v.right + TILE;
        const y0 = v.y - TILE;
        const y1 = v.bottom + TILE;
        for (const w of this.waterImgs) {
          const { x, y } = w.img;
          if (x < x0 || x > x1 || y < y0 || y > y1) continue;
          w.img.setTexture(`${w.key}_${(this.waterTick + w.ph) % WATER_FRAMES}`);
        }
      },
    });

    this.events.once('shutdown', () => {
      this.scale.off('resize', this.layout, this);
      kb.off('keydown-B', this.cycleBait, this);
      kb.off('keydown-M', this.openMap, this);
      kb.off('keydown-ESC', this.openMap, this);
      kb.off('keydown-F', this.openBook, this);
      kb.off('keydown-F3', this.toggleDebug, this);
      kb.off('keydown', this.onKeyDown, this);
      this.closeChat();
      for (const off of this.netUnsubs) off();
      this.netUnsubs = [];
      this.remotes?.destroy();
      this.remotes = undefined;
      this.selfBubble?.destroy();
      this.selfBubble = undefined;
      net.setPositionProvider(null);
      kb.removeKey(this.space);
      this.input.off('pointerdown');
      this.input.off('pointerup');
    });
  }

  /** Sizes both cameras to the canvas with an integer zoom (crisp pixels) and re-anchors the HUD. */
  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    if (w <= 0 || h <= 0) return;
    const z = Math.max(2, Math.round(h / 225));
    this.vw = w / z;
    this.vh = h / z;
    this.cameras.main.setSize(w, h).setZoom(z);
    this.uiCam?.setSize(w, h).setZoom(z).centerOn(this.vw / 2, this.vh / 2);
    for (const o of [...this.hudObjs, this.alert, this.zoneLabel]) {
      if (o?.active && o instanceof Phaser.GameObjects.Text) o.setResolution(z);
    }
  }

  private buildWorld(): void {
    const { w, h, tiles } = this.gen;
    const id = this.map.id;
    const hash = (x: number, y: number, n: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % n;
    const groundKey = (x: number, y: number, t: number) =>
      t === T.MUD || (this.map.kind === 'swamp' && t === T.TREE)
        ? `mud_${id}_${hash(x, y, 3)}`
        : `grass_${id}_${hash(x, y, 3)}`;

    const place = (key: string, x: number, y: number) => this.add.image(x * TILE, y * TILE, key).setOrigin(0, 0);
    const foam = this.add.graphics().setDepth(1);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y][x];
        switch (t) {
          case T.WATER:
          case T.DEEP: {
            const key = `${t === T.DEEP ? 'deep' : 'water'}_${id}`;
            const ph = (x + y * 3) % WATER_FRAMES;
            this.waterImgs.push({ img: place(`${key}_${ph}`, x, y), key, ph });
            // foam where water meets land
            foam.fillStyle(0xffffff, 0.5);
            const land = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < w && ny < h && !isWater(tiles[ny][nx]) && tiles[ny][nx] !== T.WOOD;
            if (land(x, y - 1)) foam.fillRect(x * TILE, y * TILE, TILE, 2);
            if (land(x, y + 1)) foam.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2);
            if (land(x - 1, y)) foam.fillRect(x * TILE, y * TILE, 2, TILE);
            if (land(x + 1, y)) foam.fillRect(x * TILE + TILE - 2, y * TILE, 2, TILE);
            break;
          }
          case T.SAND:
            place(`sand_${hash(x, y, 2)}`, x, y);
            break;
          case T.PATH:
            place(`path_${hash(x, y, 2)}`, x, y);
            break;
          case T.WOOD: {
            // water shows through between boards at the sides of docks
            place('wood', x, y);
            break;
          }
          default:
            place(groundKey(x, y, t), x, y);
        }
      }
    }

    for (const f of this.gen.flowers) {
      if (tiles[f.y][f.x] === T.GRASS) place(`flower_${f.c}`, f.x, f.y).setDepth(2);
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y][x];
        if (t === T.TREE) this.add.image(x * TILE, (y + 1) * TILE, `tree_${id}`).setOrigin(0, 1).setDepth((y + 1) * TILE);
        else if (t === T.ROCK) place('rock', x, y).setDepth((y + 1) * TILE);
      }
    }
    const s = this.gen.shop;
    this.add.image(s.x * TILE, s.y * TILE - TILE, 'shop').setOrigin(0, 0).setDepth((s.y + 2) * TILE);
  }

  private placePlayer(): void {
    let tx = this.gen.spawn.x;
    let ty = this.gen.spawn.y;
    this.dir = this.gen.spawn.dir;

    const exit = this.arriveFrom ? this.gen.exits.find((e) => e.to === this.arriveFrom) : undefined;
    const saved = session.pos;
    if (exit) {
      tx = exit.inner.x;
      ty = exit.inner.y;
      this.dir = exit.dir;
      this.px = tx * TILE + TILE / 2;
      this.py = (ty + 1) * TILE - 1;
    } else if (saved && saved.mapId === this.map.id) {
      this.px = saved.x;
      this.py = saved.y;
      this.dir = saved.dir as Dir;
    } else {
      this.px = tx * TILE + TILE / 2;
      this.py = (ty + 1) * TILE - 1;
    }
    session.pos = undefined;
    this.player = this.add.image(this.px, this.py, `p_${this.dir}_0`).setOrigin(0.5, 1);
  }

  // ---- helpers ------------------------------------------------------------

  private now(): number {
    return this.time.now;
  }

  private ctx(): FishContext {
    const t = worldMs();
    return {
      rod: currentRod(store.data),
      bait: BAIT_BY_ID[store.data.baitId] ?? BAIT_BY_ID.dough,
      time: timeOfDay(gameHour(t)),
      weather: weatherAt(t),
    };
  }

  private tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.gen.w || ty >= this.gen.h) return T.TREE;
    return this.gen.tiles[ty][tx];
  }

  private playerTile(): { tx: number; ty: number } {
    return { tx: Math.floor(this.px / TILE), ty: Math.floor((this.py - 2) / TILE) };
  }

  private saveSpot(): void {
    session.pos = { mapId: this.map.id, x: this.px, y: this.py, dir: this.dir };
    persist();
  }

  private openMap(): void {
    if (this.phase !== 'idle') return;
    this.saveSpot();
    this.scene.start('WorldMap');
  }

  private openBook(): void {
    if (this.phase !== 'idle') return;
    this.saveSpot();
    this.scene.start('Book');
  }

  private toggleDebug(): void {
    this.debug = !this.debug;
    this.debugText.setVisible(this.debug);
  }

  private cycleBait(): void {
    if (this.phase !== 'idle') return;
    const d = store.data;
    const ids = ['dough', ...Object.keys(d.bait).filter((id) => (d.bait[id] ?? 0) > 0)];
    d.baitId = ids[(ids.indexOf(d.baitId) + 1) % ids.length];
    persist();
  }

  private showToast(s: string, color = '#ffffff', ms = 1800): void {
    this.toast.setText(s).setColor(color).setVisible(true);
    this.toastUntil = this.now() + ms;
  }

  private rodLift(): number {
    return this.phase === 'charging' || (this.phase === 'casting' && this.castT < 0.2) ? 6 : 0;
  }

  private rodTip(): { x: number; y: number } {
    return rodTipAt(this.px, this.py, this.dir, this.rodLift());
  }

  /** Where a cast with this power would land, or null if there is no water in reach. */
  private castTarget(power: number): { tx: number; ty: number; deep: boolean } | null {
    const { dx, dy } = DIRS[this.dir];
    const { tx, ty } = this.playerTile();
    let first = -1;
    for (let i = 1; i <= MAX_REACH; i++) {
      if (isWater(this.tileAt(tx + dx * i, ty + dy * i))) {
        first = i;
        break;
      }
    }
    if (first < 0) return null;
    let d = Math.max(first, 2 + Math.round(power * 5));
    while (d > first && !isWater(this.tileAt(tx + dx * d, ty + dy * d))) d--;
    const lx = tx + dx * d;
    const ly = ty + dy * d;
    return { tx: lx, ty: ly, deep: this.tileAt(lx, ly) === T.DEEP };
  }

  // ---- movement -------------------------------------------------------------

  private blockedAt(x: number, y: number): boolean {
    const r = 4;
    for (const [ox, oy] of [[-r, -5], [r, -5], [-r, 0], [r, 0]]) {
      if (isSolid(this.tileAt(Math.floor((x + ox) / TILE), Math.floor((y + oy - 1) / TILE)))) return true;
    }
    return false;
  }

  private handleMove(dt: number): void {
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) vy += 1;

    this.moving = vx !== 0 || vy !== 0;
    if (this.moving) {
      if (vx !== 0 && vy !== 0) {
        vx *= Math.SQRT1_2;
        vy *= Math.SQRT1_2;
      }
      const nx = this.px + vx * SPEED * dt;
      if (!this.blockedAt(nx, this.py)) this.px = nx;
      const ny = this.py + vy * SPEED * dt;
      if (!this.blockedAt(this.px, ny)) this.py = ny;

      if (Math.abs(vx) > Math.abs(vy)) this.dir = vx < 0 ? 'left' : 'right';
      else if (vy !== 0) this.dir = vy < 0 ? 'up' : 'down';
      this.walkT += dt;
    } else {
      this.walkT = 0;
    }

    const frame = this.moving ? 1 + (Math.floor(this.walkT / 0.14) % 2) : 0;
    this.player.setTexture(`p_${this.dir}_${frame}`).setPosition(Math.round(this.px), Math.round(this.py));
    this.player.setDepth(this.py);
  }

  private checkExits(): void {
    if (this.exitCooldown > 0) return;
    const { tx, ty } = this.playerTile();
    for (const e of this.gen.exits) {
      if (!e.tiles.some((p) => p.x === tx && p.y === ty)) continue;
      const target = MAP_BY_ID[e.to];
      if (store.data.maps.includes(e.to)) {
        persist();
        session.pos = undefined;
        this.scene.restart({ mapId: e.to, from: this.map.id });
        return;
      }
      this.showToast(`${target.name} is locked: Lv ${target.unlock.level}, $${target.unlock.price}. Press M.`, '#ffd34d', 2600);
      this.px = e.inner.x * TILE + TILE / 2;
      this.py = (e.inner.y + 1) * TILE - 1;
      this.dir = e.dir;
      this.exitCooldown = 1;
      return;
    }
  }

  // ---- state machine ----------------------------------------------------------

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    const held = this.space.isDown || this.pointerHeld;
    const pressed = held && !this.prevHeld;
    const released = !held && this.prevHeld;
    this.prevHeld = held;
    this.exitCooldown = Math.max(0, this.exitCooldown - dt);

    switch (this.phase) {
      case 'idle':
        this.handleMove(dt);
        this.checkExits();
        if (pressed) this.tryAction();
        break;

      case 'charging': {
        this.power += this.powerDir * dt * 1.1;
        if (this.power >= 1) {
          this.power = 1;
          this.powerDir = -1;
        } else if (this.power <= 0) {
          this.power = 0;
          this.powerDir = 1;
        }
        if (released) this.cast();
        break;
      }

      case 'casting': {
        this.castT += dt;
        const t = Math.min(1, this.castT / CAST_TIME);
        const tip = this.rodTip();
        const tx = this.target.tx * TILE + TILE / 2;
        const ty = this.target.ty * TILE + TILE / 2;
        this.bobber.x = tip.x + (tx - tip.x) * t;
        this.bobber.y = tip.y + (ty - tip.y) * t - Math.sin(t * Math.PI) * 28;
        if (t >= 1) this.land();
        break;
      }

      case 'waiting': {
        this.biteTimer -= dt;
        this.bobber.y = this.target.ty * TILE + TILE / 2 + Math.sin(this.now() / 400) * 0.8;
        if (pressed) {
          this.showToast('Reeled in too early.', '#c8d0d8');
          this.resetToIdle();
        } else if (this.biteTimer <= 0) {
          this.startBite();
        }
        break;
      }

      case 'bite':
        this.hookTimer -= dt;
        this.bobber.y = this.target.ty * TILE + TILE / 2 + 3 + Math.sin(this.now() / 40) * 1.5;
        if (pressed) {
          this.reel = newReel();
          this.phase = 'reeling';
        } else if (this.hookTimer <= 0) {
          store.data.stats.escapes++;
          this.showToast('It got away...', '#ff9a8a');
          this.resetToIdle();
        }
        break;

      case 'reeling': {
        const fish = this.hooked!;
        const status = stepReel(this.reel, held, dt, fish, currentRod(store.data).barSize, defaultRng);
        const p = this.reel.progress;
        const tip = this.rodTip();
        const bx = this.target.tx * TILE + TILE / 2;
        const by = this.target.ty * TILE + TILE / 2;
        this.bobber.x = bx + (tip.x - bx) * p * 0.8;
        this.bobber.y = by + (tip.y - by) * p * 0.8 + Math.sin(this.now() / 70) * 1.2;
        if (status === 'won') this.finishCatch(fish);
        else if (status === 'lost') {
          store.data.stats.escapes++;
          persist();
          this.showToast(`The ${fish.name} broke free!`, '#ff9a8a');
          this.resetToIdle();
        }
        break;
      }

      case 'result':
        if (pressed && this.now() >= this.popupReadyAt) {
          this.tweens.killTweensOf(this.popup);
          this.popup.forEach((o) => o.destroy());
          this.popup = [];
          this.resetToIdle();
        }
        break;
    }

    this.syncNet(dt);
    this.drawWorldFx();
    this.drawScreenFx(dt);
    this.drawOverlayUi();
    this.updateText();
  }

  private tryAction(): void {
    const { dx, dy } = DIRS[this.dir];
    const { tx, ty } = this.playerTile();
    const ahead = this.tileAt(tx + dx, ty + dy);
    if (ahead === T.DOOR || ahead === T.SHOP) {
      this.saveSpot();
      this.scene.start('Shop');
      return;
    }
    if (!this.castTarget(0)) {
      this.showToast('Face the water to fish.', '#c8d0d8');
      return;
    }
    this.phase = 'charging';
    this.power = 0;
    this.powerDir = 1;
    this.moving = false;
    this.player.setTexture(`p_${this.dir}_0`);
  }

  private cast(): void {
    const target = this.castTarget(this.power);
    if (!target) {
      this.resetToIdle();
      return;
    }
    const bait = consumeBait(store.data);
    store.data.stats.casts++;
    persist();
    if (bait.id === 'dough' && store.data.baitId === 'dough' && this.ctx().bait.id !== 'dough') this.showToast('Out of bait. Switched to dough.', '#ffd34d');
    this.target = target;
    const tip = this.rodTip();
    this.bobber = { x: tip.x, y: tip.y };
    this.castT = 0;
    this.phase = 'casting';
  }

  private land(): void {
    this.zone = zoneForDepth(this.map, this.target.deep);
    this.biteTimer = biteDelay(defaultRng, this.ctx());
    this.phase = 'waiting';
  }

  private startBite(): void {
    this.hooked = rollFish(defaultRng, this.zone, this.ctx());
    this.hookTimer = HOOK_WINDOW;
    this.phase = 'bite';
  }

  private resetToIdle(): void {
    this.hooked = null;
    this.phase = 'idle';
  }

  private finishCatch(fish: FishDef): void {
    const quality = reelQuality(this.reel);
    const size = rollSize(defaultRng, fish);
    const out = recordCatch(store.data, fish, size, quality);
    persist();
    this.phase = 'result';
    this.popupReadyAt = this.now() + 450;
    this.showCatchPopup(fish, size, quality, out);
  }

  private showCatchPopup(
    fish: FishDef,
    size: number,
    quality: number,
    out: { value: number; isNew: boolean; isRecord: boolean; leveledUp: boolean },
  ): void {
    const cx = this.vw / 2;
    const cy = this.vh / 2;
    const fixed = <O extends Phaser.GameObjects.GameObject & { setDepth(d: number): unknown }>(o: O): O => {
      o.setDepth(DEPTH_UI + 5);
      this.cameras.main.ignore(o);
      this.popup.push(o);
      return o;
    };
    fixed(this.add.rectangle(cx, cy, this.vw, this.vh, 0x000000, 0.55));
    fixed(this.add.rectangle(cx, cy, 184, 132, 0x3b2818).setStrokeStyle(2, 0xd9b074));

    // a soft glow in the rarity colour behind the better fish
    if (fish.rarity !== 'common' && fish.rarity !== 'uncommon') {
      const glow = fixed(this.add.ellipse(cx, cy - 14, 132, 62, Phaser.Display.Color.HexStringToColor(RARITY_COLOR[fish.rarity]).color, 0.16));
      this.tweens.add({ targets: glow, alpha: 0.3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    const sprite = fixed(this.add.image(cx, cy - 14, `fish_${fish.id}`).setScale(2));
    this.tweens.add({ targets: sprite, y: cy - 16, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    const grade = quality > 0.85 ? 'Perfect!' : quality > 0.6 ? 'Nice catch' : 'Barely landed';
    fixed(txt(this, cx, cy - 59, grade, 8, '#ffe9c4', 0.5));
    fixed(txt(this, cx, cy + 20, fish.name, 10, RARITY_COLOR[fish.rarity], 0.5));
    fixed(txt(this, cx, cy + 34, `${fish.rarity}  -  ${size} cm  -  $${out.value}`, 8, '#e8d8b0', 0.5));
    const tags: string[] = [];
    if (out.isNew) tags.push('NEW!');
    if (out.isRecord) tags.push('RECORD SIZE!');
    if (out.leveledUp) tags.push(`LEVEL ${levelOf(store.data.xp)}!`);
    if (tags.length) fixed(txt(this, cx, cy + 46, tags.join('  '), 8, '#ffd34d', 0.5));
    fixed(txt(this, cx, cy + 57, 'Click or SPACE to continue', 7, '#cdb98f', 0.5));
  }

  // ---- drawing ----------------------------------------------------------------

  // ---- multiplayer -------------------------------------------------------------

  private setupNet(): void {
    const hideFromHud = (o: Phaser.GameObjects.GameObject) => this.uiCam?.ignore(o);
    this.remotes = new RemotePlayers(this, hideFromHud);
    this.selfBubble = new Bubble(this, hideFromHud);
    this.moveThrottle.reset();
    this.fishThrottle.reset();

    this.netUnsubs.push(
      net.onCorrect(({ x, y }) => {
        // the server says that move was too fast to be walking: go back to where it has you
        this.px = x;
        this.py = y;
        this.moveThrottle.reset();
      }),
      net.onEmote((id, e) => id === net.selfId && this.selfBubble?.show(EMOTE_GLYPH[e] ?? '?', this.now(), 2500)),
      net.onChat((id, _name, text) => id === net.selfId && this.selfBubble?.show(text, this.now(), 5000)),
    );

    if (net.enabled && getOnline()) {
      net.setPositionProvider(() => ({ x: this.px, y: this.py }));
      void net.join({ mapId: this.map.id, code: getCode(), name: getName(), x: this.px, y: this.py });
    } else {
      net.leave();
    }
  }

  /** Once a frame: move the other players, and tell the server where we are and what we are doing. */
  private syncNet(dt: number): void {
    const t = this.now();
    this.remotes?.update(t, dt);
    this.selfBubble?.place(this.px, this.py - 31, t);
    if (!net.online) return;

    const move: MovePayload = { x: roundPos(this.px), y: roundPos(this.py), dir: this.dir, moving: this.moving };
    if (this.moveThrottle.shouldSend(move, t)) net.sendMove(move);

    const fish: FishPayload = { state: toFishState(this.phase), bx: Math.round(this.bobber.x), by: Math.round(this.bobber.y) };
    if (this.fishThrottle.shouldSend(fish, t)) net.sendFish(fish);
  }

  private updateNetText(): void {
    this.netText.setX(this.vw - 6);
    if (!net.enabled) {
      this.netText.setText('');
      return;
    }
    if (!getOnline()) {
      this.netText.setText('Offline').setColor('#cdb98f');
    } else if (net.status === 'online') {
      const ping = net.rtt ? `  ${net.rtt}ms` : '';
      this.netText.setText(`Online: ${net.playerCount} here${ping}`).setColor('#a6e36a');
    } else if (net.status === 'connecting') {
      this.netText.setText(net.detail || 'Connecting...').setColor('#ffd34d');
    } else {
      this.netText.setText(net.detail || 'Offline').setColor('#ff9a8a');
    }
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.chatInput || !net.online) return;
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') this.openChat();
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(ev.code);
    if (n >= 0) net.sendEmote(n);
  }

  /** A text box over the game: Enter sends, Escape cancels. The server cleans and rate-limits it. */
  private openChat(): void {
    if (this.chatInput || this.phase === 'result') return;
    this.input.keyboard?.resetKeys(); // keys held now would otherwise stay "down" while typing
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = 80;
    el.autocomplete = 'off';
    el.placeholder = 'Say something...  (Enter to send, Esc to cancel)';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      bottom: '9%',
      transform: 'translateX(-50%)',
      width: 'min(520px, 80vw)',
      padding: '8px 10px',
      font: '14px monospace',
      color: '#fff4d6',
      background: '#2b1d10',
      border: '2px solid #d9b074',
      outline: 'none',
      zIndex: '10',
    });
    // keep typing away from the game's own key handlers (space, f, m, ... must not trigger anything)
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        net.sendChat(el.value);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    document.body.appendChild(el);
    el.focus();
    this.chatInput = el;
  }

  private closeChat(): void {
    if (!this.chatInput) return;
    this.chatInput.remove();
    this.chatInput = null;
    this.input.keyboard?.resetKeys();
  }

  private drawWorldFx(): void {
    const g = this.wg;
    g.clear();

    if (this.phase === 'charging') {
      const t = this.castTarget(this.power);
      if (t) {
        const cx = t.tx * TILE + TILE / 2;
        const cy = t.ty * TILE + TILE / 2;
        const pulse = 5 + Math.sin(this.now() / 120) * 1.2;
        g.lineStyle(1, 0xffffff, 0.9);
        g.strokeEllipse(cx, cy, pulse * 2, pulse);
        g.lineStyle(1, 0xffffff, 0.5);
        g.strokeEllipse(cx, cy, pulse * 3, pulse * 1.5);
      }
    }

    drawRig(g, { x: this.px, y: this.py, dir: this.dir, phase: this.phase, lift: this.rodLift(), bobX: this.bobber.x, bobY: this.bobber.y }, this.now());
    this.remotes?.draw(g, this.now());
  }

  private drawScreenFx(dt: number): void {
    const f = this.fx;
    f.clear();
    const t = worldMs();
    const hour = gameHour(t);
    const weather = weatherAt(t);
    const night = nightFactor(hour);

    if (night > 0) {
      f.fillStyle(lerpColor(0xff8a40, 0x0a1038, night), night * 0.45);
      f.fillRect(0, 0, this.vw, this.vh);
    }
    if (weather === 'rain') {
      f.fillStyle(0x20304a, 0.18);
      f.fillRect(0, 0, this.vw, this.vh);
      f.lineStyle(1, 0xcfe6ff, 0.55);
      for (const d of this.drops) {
        d.y += d.v * dt;
        d.x -= 20 * dt;
        if (d.y > this.vh) {
          d.y = -4;
          d.x = Math.random() * this.vw + 20;
        }
        f.lineBetween(d.x, d.y, d.x - 1.5, d.y + 5);
      }
    } else if (weather === 'fog') {
      f.fillStyle(0xdfe6ee, 0.3);
      f.fillRect(0, 0, this.vw, this.vh);
    }
  }

  private drawOverlayUi(): void {
    const u = this.ui;
    u.clear();
    const track = { ...TRACK, x: this.vw - 24 };
    u.fillStyle(0x000000, 0.5);
    u.fillRect(0, 0, this.vw, 24);

    if (this.phase === 'charging') {
      const bw = 120;
      const bx = (this.vw - bw) / 2;
      const by = this.vh - 22;
      u.fillStyle(0x000000, 0.65);
      u.fillRect(bx - 2, by - 2, bw + 4, 10);
      u.fillStyle(0x3a2a1a, 1);
      u.fillRect(bx, by, bw, 6);
      u.fillStyle(0xe6b04a, 1);
      u.fillRect(bx, by, bw * this.power, 6);
      u.fillStyle(0xffffff, 1);
      for (let i = 0; i <= 5; i++) u.fillRect(bx + (bw * i) / 5 - 0.5, by - 2, 1, 2);
      u.fillRect(bx + this.power * bw - 1, by - 3, 2, 12);
    }

    if (this.phase === 'reeling') {
      const rod = currentRod(store.data);
      const s = this.reel;
      u.fillStyle(0x000000, 0.55);
      u.fillRect(track.x - 3, track.y - 3, track.w + 6 + 8, track.h + 6);
      u.fillStyle(0x2f2216, 1);
      u.fillRect(track.x, track.y, track.w, track.h);

      const barH = rod.barSize * track.h;
      const barY = track.y + track.h - (s.bar + rod.barSize) * track.h;
      const inside = s.fish >= s.bar && s.fish <= s.bar + rod.barSize;
      u.fillStyle(inside ? 0x5be07a : 0x3aa05a, 0.9);
      u.fillRect(track.x, barY, track.w, barH);

      // a plain marker for where the fish is, so the meter stays readable without showing the fish
      const my = track.y + track.h - s.fish * track.h;
      u.fillStyle(0x2f2216, 1);
      u.fillCircle(track.x + track.w / 2, my, 4.5);
      u.fillStyle(0xffd34d, 1);
      u.fillCircle(track.x + track.w / 2, my, 3.5);
      u.fillStyle(0xfff4c0, 1);
      u.fillCircle(track.x + track.w / 2 - 1, my - 1, 1.2);

      const px = track.x + track.w + 2;
      u.fillStyle(0x2f2216, 1);
      u.fillRect(px, track.y, 4, track.h);
      u.fillStyle(lerpColor(0xe84a3c, 0x5be07a, s.progress), 1);
      u.fillRect(px, track.y + track.h * (1 - s.progress), 4, track.h * s.progress);
    }
  }

  private updateText(): void {
    const d = store.data;
    const t = this.now();
    const world = worldMs();
    const hour = gameHour(world);
    const level = levelOf(d.xp);
    const into = d.xp - xpForLevel(level);
    const need = xpForLevel(level + 1) - xpForLevel(level);
    const bait = BAIT_BY_ID[d.baitId] ?? BAIT_BY_ID.dough;
    const left = bait.id === 'dough' ? '' : ` x${d.bait[bait.id] ?? 0}`;

    this.hudTop.setText(`${this.map.name}   Lv ${level} (${into}/${need})   $${d.coins}`);
    const hh = String(Math.floor(hour)).padStart(2, '0');
    this.hudBottom.setText(
      `${hh}:00 ${timeOfDay(hour)}, ${weatherAt(world)}   ${currentRod(d).name}   Bait: ${bait.name}${left}   Bag ${d.inventory.length}`,
    );

    const hints: Record<Phase, string> = {
      idle: net.online ? 'WASD move | SPACE fish | B bait | F book | M map | 1-4 emote | ENTER chat' : 'WASD move | SPACE fish / shop | B bait | F book | M map',
      charging: 'Release SPACE to cast!',
      casting: '',
      waiting: 'Waiting for a bite...  (SPACE to reel in)',
      bite: 'HOOK IT! Press SPACE / click!',
      reeling: 'Hold SPACE / click to raise the bar. Keep the fish inside!',
      result: '',
    };
    this.hint.setX(this.vw / 2);
    this.toast.setX(this.vw / 2);
    this.updateNetText();
    this.hint.setText(hints[this.phase]);
    this.hint.setColor(this.phase === 'bite' ? '#ffef5a' : '#ffffff');
    this.hint.setY(this.phase === 'charging' ? this.vh - 28 : this.vh - 4);

    const showAlert = this.phase === 'bite';
    this.alert.setVisible(showAlert);
    if (showAlert) this.alert.setPosition(this.bobber.x, this.bobber.y - 8);

    const showZone = this.phase === 'waiting' || this.phase === 'bite';
    this.zoneLabel.setVisible(showZone);
    if (showZone) this.zoneLabel.setText(this.zone.name).setPosition(this.bobber.x, this.bobber.y - (this.phase === 'bite' ? 24 : 10));

    if (this.toast.visible && t > this.toastUntil) this.toast.setVisible(false);

    if (this.debug) {
      const ctx = this.ctx();
      const pt = this.playerTile();
      this.debugText.setText(
        [
          `phase ${this.phase}  tile ${pt.tx},${pt.ty}  dir ${this.dir}`,
          `power ${this.power.toFixed(2)}  target ${this.target.tx},${this.target.ty} ${this.target.deep ? 'deep' : 'shallow'}`,
          `zone ${this.zone?.id ?? '-'}  biteIn ${this.biteTimer.toFixed(1)}  hook ${this.hookTimer.toFixed(1)}`,
          `fish ${this.hooked?.id ?? '-'}  ${ctx.time}/${ctx.weather}`,
          this.phase === 'reeling' ? `progress ${this.reel.progress.toFixed(2)}` : '',
        ].join('\n'),
      );
    }
  }
}
