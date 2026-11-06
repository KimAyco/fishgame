import Phaser from 'phaser';
import { BAIT_BY_ID } from '../data/gear';
import { MAP_BY_ID } from '../data/maps';
import { currentRod, levelOf, xpForLevel } from '../logic/economy';
import {
  biteDelay,
  FishContext,
  HOOK_WINDOW,
  newReel,
  ReelState,
  reelQuality,
  rollFish,
  stepReel,
  zoneForDepth,
} from '../logic/fishing';
import { FISH_BY_ID } from '../data/fish';
import { defaultRng } from '../logic/rng';
import { gameHour, timeOfDay, weatherAt } from '../logic/time';
import { session, store } from '../save/storage';
import type { FishDef, MapDef, ZoneDef } from '../types';
import { lerpColor, nightFactor, RARITY_COLOR, txt } from '../ui/ui';
import { Hud } from '../ui/hud';
import { BagModal, BaitModal, Modal } from '../ui/modals';
import { bagValue } from '../logic/bag';
import { ensureTextures, WATER_FRAMES } from '../world/art';
import { ensureFishSprites } from '../world/fishart';
import { worldMs } from '../logic/clock';
import { net } from '../net/NetClient';
import {
  equipBaitOnline,
  getGameToken,
  loadWorldObjects,
  placeItem,
  recordCatchOnline,
  recordEscapeOnline,
  saveCheckpoint,
  useBaitOnline,
  type SharedWorldObject,
} from '../net/gameApi';
import { EMOTE_GLYPH, FISH_INTERVAL_MS, FishPayload, MOVE_INTERVAL_MS, MovePayload, roundPos, SendThrottle, toFishState } from '../net/protocol';
import { Bubble, RemotePlayers } from '../net/remotePlayers';
import { drawRig, rodTipAt } from '../world/rig';
import { Dir, DIRS, GeneratedMap, generateMap, isSolid, isWater, T, TILE } from '../world/mapgen';

type Phase = 'idle' | 'charging' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'result';
type MobileControl =
  | { type: 'move'; x: number; y: number }
  | { type: 'fish'; pressed: boolean }
  | { type: 'chat-focus' }
  | { type: 'chat-blur' }
  | { type: 'chat-submit'; id: number; text: string }
  | { type: 'action'; action: 'map' | 'bag' | 'bait' | 'book' | 'interact' | 'boat' | 'tent' | 'chat' | 'closeChat' };

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
  private mobileFishHeld = false;
  private mobileMove = { x: 0, y: 0 };
  private prevHeld = false;
  private readonly onMobileControl = (event: Event): void => {
    const control = (event as CustomEvent<MobileControl>).detail;
    if (!control) return;
    if (control.type === 'move') {
      this.mobileMove.x = Number.isFinite(control.x) ? Phaser.Math.Clamp(control.x, -1, 1) : 0;
      this.mobileMove.y = Number.isFinite(control.y) ? Phaser.Math.Clamp(control.y, -1, 1) : 0;
      return;
    }
    if (control.type === 'fish') {
      this.mobileFishHeld = control.pressed;
      return;
    }
    if (control.type === 'chat-focus') {
      this.chatInput = document.getElementById('world-chat-input') as HTMLInputElement | null;
      return;
    }
    if (control.type === 'chat-blur') {
      this.chatInput = null;
      return;
    }
    if (control.type === 'chat-submit') {
      const sent = net.sendChat(control.text);
      window.dispatchEvent(new CustomEvent('pixel-fishing:chat-send-result', { detail: { id: control.id, sent } }));
      if (!sent) {
        const text = net.worldChatError || net.detail || 'World chat is reconnecting. Please try again.';
        window.dispatchEvent(new CustomEvent('pixel-fishing:world-chat-status', { detail: { text } }));
      }
      return;
    }
    switch (control.action) {
      case 'map': this.openMap(); break;
      case 'bag': this.toggleBag(); break;
      case 'bait': this.toggleBait(); break;
      case 'book': this.openBook(); break;
      case 'interact': this.interact(); break;
      case 'boat': this.placeBoat(); break;
      case 'tent': this.placeTent(); break;
      case 'chat': this.openChat(); break;
      case 'closeChat': this.closeChat(); break;
    }
  };

  private wg!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;

  private phase: Phase = 'idle';
  private power = 0;
  private powerDir = 1;
  private castT = 0;
  private castAnimationDone = false;
  private baitRequestPending = false;
  private castRequestId = 0;
  private baitIdBeforeCast = 'dough';
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
  private worldObjects: SharedWorldObject[] = [];
  private worldObjectDrawings: Phaser.GameObjects.GameObject[] = [];
  private onBoat = false;
  private boatSaveInFlight = false;
  private boatTile = '';
  private boatPosition = { x: 0, y: 0 };
  private moveThrottle = new SendThrottle<MovePayload>(MOVE_INTERVAL_MS, (a, b) => a.x === b.x && a.y === b.y && a.dir === b.dir && a.moving === b.moving);
  private fishThrottle = new SendThrottle<FishPayload>(FISH_INTERVAL_MS, (a, b) => a.state === b.state && a.bx === b.bx && a.by === b.by);
  private popupReadyAt = 0;
  private debug = false;
  private exitCooldown = 0;

  private hud!: Hud;
  /** the open bag / bait panel, if any; while set the player can't walk or cast */
  private modal: { kind: 'bag' | 'bait'; panel: Modal } | null = null;
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
    document.body.dataset.scene = 'Fishing';
    window.addEventListener('pixel-fishing:mobile-control', this.onMobileControl);
    this.uiCam = undefined;
    this.layout();
    ensureTextures(this, this.map);
    ensureFishSprites(this);
    this.gen = generateMap(this.map);
    store.data.lastMap = this.map.id;
    this.worldObjects = [];
    this.worldObjectDrawings = [];
    this.onBoat = false;
    this.boatSaveInFlight = false;
    this.boatTile = '';

    this.phase = 'idle';
    this.power = 0;
    this.prevHeld = false;
    this.pointerHeld = false;
    this.mobileFishHeld = false;
    this.mobileMove.x = 0;
    this.mobileMove.y = 0;
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
    this.modal = null;
    this.hud = new Hud(this, DEPTH_UI);
    this.hint = hud(txt(this, this.vw / 2, this.vh - 4, '', 7, '#ffffff', 0.5, 1));
    this.debugText = hud(txt(this, 6, 52, '', 7, '#9aff9a')).setVisible(false);
    this.toast = hud(txt(this, this.vw / 2, 42, '', 9, '#ffffff', 0.5, 0)).setVisible(false);
    this.netText = hud(txt(this, this.vw - 6, 4, '', 7, '#cdb98f', 1, 0));
    this.hudObjs = [this.fx, this.ui, ...this.hud.objs, this.hint, this.debugText, this.toast, this.netText];

    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.ignore(worldObjs);
    this.layout();
    this.cameras.main.ignore(this.hudObjs);
    this.setupNet();
    void this.refreshWorldObjects(true);
    this.time.addEvent({ delay: 12000, loop: true, callback: () => void this.refreshWorldObjects(false) });

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.gen.w * TILE, this.gen.h * TILE);
    cam.startFollow(this.player, true, 0.2, 0.2);
    cam.setRoundPixels(true);
    cam.centerOn(this.px, this.py);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys('W,A,S,D') as typeof this.wasd;
    this.space = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    kb.on('keydown-B', this.toggleBait, this);
    kb.on('keydown-I', this.toggleBag, this);
    kb.on('keydown-TAB', this.cycleBait, this);
    kb.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB); // keep Tab from moving browser focus
    kb.on('keydown-M', this.openMap, this);
    kb.on('keydown-ESC', this.openMap, this);
    kb.on('keydown-F', this.openBook, this);
    kb.on('keydown-F3', this.toggleDebug, this);
    kb.on('keydown-E', this.interact, this);
    kb.on('keydown-P', this.placeBoat, this);
    kb.on('keydown-O', this.placeTent, this);
    kb.on('keydown', this.onKeyDown, this);
    void saveCheckpoint(this.map.id, this.px, this.py, this.dir).catch((error: unknown) => {
      this.showToast(error instanceof Error ? `Cloud save failed: ${error.message}` : 'Cloud save failed', '#ff9a8a');
    });

    this.scale.on('resize', this.layout, this);
    this.input.on('pointerdown', () => (this.pointerHeld = true));
    this.input.on('pointerup', () => (this.pointerHeld = false));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.modal?.panel.wheel(dy));

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
      window.removeEventListener('pixel-fishing:mobile-control', this.onMobileControl);
      document.getElementById('world-chat-input')?.blur();
      this.chatInput = null;
      if (document.body.dataset.scene === 'Fishing') delete document.body.dataset.scene;
      this.scale.off('resize', this.layout, this);
      kb.off('keydown-B', this.toggleBait, this);
      kb.off('keydown-I', this.toggleBag, this);
      kb.off('keydown-TAB', this.cycleBait, this);
      kb.removeCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
      this.closeModal();
      kb.off('keydown-M', this.openMap, this);
      kb.off('keydown-ESC', this.openMap, this);
      kb.off('keydown-F', this.openBook, this);
      kb.off('keydown-F3', this.toggleDebug, this);
      kb.off('keydown-E', this.interact, this);
      kb.off('keydown-P', this.placeBoat, this);
      kb.off('keydown-O', this.placeTent, this);
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
      this.input.off('wheel');
    });
  }

  /** Keeps portrait gameplay close while sizing both cameras and re-anchoring the HUD. */
  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    if (w <= 0 || h <= 0) return;
    const portraitPhone = w < h && w < 760;
    const z = portraitPhone
      ? Math.max(2, Math.floor(Math.min(w / 250, h / 420)))
      : Math.max(1, Math.floor(Math.min(w / 320, h / 180)));
    this.vw = w / z;
    this.vh = h / z;
    this.cameras.main.setSize(w, h).setZoom(z);
    this.uiCam?.setSize(w, h).setZoom(z).centerOn(this.vw / 2, this.vh / 2);
    this.modal?.panel.refresh();
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
          case T.DEEP:
          case T.SHALLOW_WATER: {
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
          case T.MARKET_FLOOR:
            place(`path_${hash(x, y, 2)}`, x, y);
            break;
          case T.WOOD:
          case T.BRIDGE: {
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
    if (this.map.isMarket) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (tiles[y][x] !== T.DOOR) continue;
          this.add.image((x - 1) * TILE, (y - 2) * TILE, 'shop').setOrigin(0, 0).setDepth(y * TILE);
        }
      }
    }
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
    void saveCheckpoint(this.map.id, this.px, this.py, this.dir).catch((error: unknown) => {
      this.showToast(error instanceof Error ? `Cloud save failed: ${error.message}` : 'Cloud save failed', '#ff9a8a');
    });
  }

  private openMap(): void {
    if (this.modal) return this.closeModal(); // ESC closes a panel before it leaves the scene
    if (this.phase !== 'idle') return;
    this.saveSpot();
    this.scene.start('WorldMap');
  }

  private openBook(): void {
    if (this.modal || this.phase !== 'idle') return;
    this.saveSpot();
    this.scene.start('Book');
  }

  private toggleDebug(): void {
    this.debug = !this.debug;
    this.debugText.setVisible(this.debug);
  }

  /** Tab: swap to the next bait you own without opening the picker. */
  private async cycleBait(): Promise<void> {
    if (this.modal || this.phase !== 'idle') return;
    const d = store.data;
    const ids = ['dough', ...Object.keys(d.bait).filter((id) => (d.bait[id] ?? 0) > 0)];
    const baitId = ids[(ids.indexOf(d.baitId) + 1) % ids.length];
    try {
      await equipBaitOnline(baitId);
      d.baitId = baitId;
      this.showToast(`Using ${(BAIT_BY_ID[d.baitId] ?? BAIT_BY_ID.dough).name}`, '#c8d0d8', 1200);
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : 'Could not change bait', '#ff9a8a');
    }
  }

  private toggleBait(): void {
    this.togglePanel('bait');
  }

  private toggleBag(): void {
    this.togglePanel('bag');
  }

  /** Opens the bag or bait panel (only while standing idle), or closes it if it is already open. */
  private togglePanel(kind: 'bag' | 'bait'): void {
    if (this.modal) {
      const same = this.modal.kind === kind;
      this.closeModal();
      if (same) return;
    }
    if (this.phase !== 'idle' || this.chatInput) return;
    this.moving = false;
    this.player.setTexture(`p_${this.dir}_0`);
    const host = {
      scene: this as Phaser.Scene,
      view: () => ({ vw: this.vw, vh: this.vh }),
      depth: DEPTH_UI + 10,
      register: (o: Phaser.GameObjects.GameObject) => this.cameras.main.ignore(o),
      nearShop: () => this.nearShop(),
      toast: (s: string, color?: string, ms?: number) => this.showToast(s, color, ms),
      close: () => this.closeModal(),
    };
    const panel = kind === 'bag' ? BagModal.open(host) : BaitModal.open(host);
    this.modal = { kind, panel };
  }

  private closeModal(): void {
    if (!this.modal) return;
    this.modal.panel.destroy();
    this.modal = null;
    this.pointerHeld = false; // the click that closed a panel must not start a cast
  }

  /** True while facing the shop door, which is where the bag can be sold. */
  private nearShop(): boolean {
    if (!this.map.isMarket) return false;
    const { dx, dy } = DIRS[this.dir];
    const { tx, ty } = this.playerTile();
    const ahead = this.tileAt(tx + dx, ty + dy);
    return ahead === T.DOOR || ahead === T.SHOP;
  }

  private async refreshWorldObjects(showError: boolean): Promise<void> {
    try {
      const objects = await loadWorldObjects(this.map.id);
      if (!this.scene.isActive('Fishing')) return;
      this.worldObjects = objects;
      for (const drawing of this.worldObjectDrawings) drawing.destroy();
      this.worldObjectDrawings = [];
      for (const object of objects) {
        if (object.x === null || object.y === null) continue;
        const x = object.x;
        const y = object.y;
        const graphic = this.add.graphics().setDepth(y);
        if (object.kind === 'boat') {
          graphic.fillStyle(0x6b3f24, 1).fillEllipse(x, y, 22, 8);
          graphic.fillStyle(0xd9b074, 1).fillRect(x - 1, y - 10, 2, 13);
          graphic.lineStyle(1, 0xffe9c4, 1).strokeEllipse(x, y, 22, 8);
        } else {
          graphic.fillStyle(0xa34f35, 1).fillTriangle(x - 9, y - 2, x + 9, y - 2, x, y - 14);
          graphic.fillStyle(0xe4c58a, 1).fillRect(x - 7, y - 3, 14, 8);
        }
        this.uiCam?.ignore(graphic);
        this.worldObjectDrawings.push(graphic);
        if (!object.ownedByMe) {
          const label = txt(this, x, y - 18, object.ownerName, 6, '#fff4d6', 0.5, 1).setDepth(y + 1);
          this.uiCam?.ignore(label);
          this.worldObjectDrawings.push(label);
        }
      }
    } catch (error) {
      if (showError && this.scene.isActive('Fishing')) {
        this.showToast(error instanceof Error ? `World objects unavailable: ${error.message}` : 'World objects unavailable', '#ff9a8a');
      }
    }
  }

  private nearbyOwned(kind: 'boat' | 'tent'): SharedWorldObject | undefined {
    return this.worldObjects.find(
      (object) =>
        object.kind === kind &&
        object.ownedByMe &&
        object.x !== null &&
        object.y !== null &&
        Math.hypot(object.x - this.px, object.y - this.py) <= 23,
    );
  }

  private interact(): void {
    if (this.modal || this.phase !== 'idle') return;
    if (this.onBoat) {
      const { tx, ty } = this.playerTile();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = tx + dx;
        const y = ty + dy;
        const tile = this.tileAt(x, y);
        if (isWater(tile) || isSolid(tile)) continue;
        this.onBoat = false;
        this.px = x * TILE + TILE / 2;
        this.py = (y + 1) * TILE - 1;
        this.player.setPosition(this.px, this.py);
        this.showToast('You left the boat.', '#c8d0d8');
        return;
      }
      this.showToast('Move closer to shore to leave the boat.', '#ffd34d');
      return;
    }

    const tent = this.nearbyOwned('tent');
    if (tent) {
      this.saveSpot();
      this.scene.start('Tent', { tentId: tent.id, mapId: this.map.id });
      return;
    }
    const boat = this.nearbyOwned('boat');
    if (boat && boat.x !== null && boat.y !== null) {
      this.onBoat = true;
      this.px = boat.x;
      this.py = boat.y;
      this.boatPosition = { x: boat.x, y: boat.y };
      this.boatTile = `${Math.floor(boat.x / TILE)},${Math.floor(boat.y / TILE)}`;
      this.player.setPosition(this.px, this.py);
      this.showToast('On board. Move through water; press E near shore to leave.', '#8aff8a', 2500);
      return;
    }
    this.showToast('Stand beside your boat or tent to use it.', '#c8d0d8');
  }

  private placeBoat(): void {
    this.placeFacingItem('boat');
  }

  private placeTent(): void {
    this.placeFacingItem('tent');
  }

  private placeFacingItem(kind: 'boat' | 'tent'): void {
    if (this.modal || this.phase !== 'idle' || this.onBoat) return;
    const owned = store.data.placeables.find((placeable) => placeable.kind === kind);
    if (!owned) {
      this.showToast(`Buy a ${kind} at the market first.`, '#ffd34d');
      return;
    }
    const { tx, ty } = this.playerTile();
    const { dx, dy } = DIRS[this.dir];
    void placeItem(owned.kind, this.map.id, tx + dx, ty + dy).then(
      async (placed) => {
        const index = store.data.placeables.findIndex((placeable) => placeable.kind === placed.kind);
        if (index >= 0) store.data.placeables[index] = placed;
        await this.refreshWorldObjects(false);
        this.showToast(`${placed.kind === 'boat' ? 'Boat' : 'Tent'} deployed. Press E beside it to use.`, '#8aff8a', 2300);
      },
      (error: unknown) => this.showToast(error instanceof Error ? error.message : 'Could not place item', '#ff9a8a'),
    );
  }

  private persistBoatPosition(): void {
    const { tx, ty } = this.playerTile();
    const tileKey = `${tx},${ty}`;
    if (this.boatSaveInFlight || tileKey === this.boatTile) return;
    this.boatSaveInFlight = true;
    void placeItem('boat', this.map.id, tx, ty).then(
      async (boat) => {
        this.boatTile = tileKey;
        this.boatPosition = { x: this.px, y: this.py };
        const index = store.data.placeables.findIndex((placeable) => placeable.kind === 'boat');
        if (index >= 0) store.data.placeables[index] = boat;
        await this.refreshWorldObjects(false);
      },
      (error: unknown) => {
        this.onBoat = false;
        this.px = this.boatPosition.x;
        this.py = this.boatPosition.y;
        this.player.setPosition(this.px, this.py);
        this.showToast(error instanceof Error ? `Boat movement failed: ${error.message}` : 'Boat movement failed', '#ff9a8a');
      },
    ).finally(() => {
      this.boatSaveInFlight = false;
    });
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
    if (this.onBoat) return !isWater(this.tileAt(Math.floor(x / TILE), Math.floor((y - 1) / TILE)));
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
    vx += this.mobileMove.x;
    vy += this.mobileMove.y;

    const magnitude = Math.hypot(vx, vy);
    this.moving = magnitude > 0.1;
    if (this.moving) {
      if (magnitude > 1) {
        vx /= magnitude;
        vy /= magnitude;
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
    if (this.onBoat) this.persistBoatPosition();
  }

  private checkExits(): void {
    if (this.exitCooldown > 0) return;
    const { tx, ty } = this.playerTile();
    for (const e of this.gen.exits) {
      if (!e.tiles.some((p) => p.x === tx && p.y === ty)) continue;
      const target = MAP_BY_ID[e.to];
      if (store.data.maps.includes(e.to)) {
        session.pos = undefined;
        this.saveSpot();
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
    const held = !this.modal && (this.space.isDown || this.pointerHeld || this.mobileFishHeld);
    const pressed = held && !this.prevHeld;
    const released = !held && this.prevHeld;
    this.prevHeld = held;
    this.exitCooldown = Math.max(0, this.exitCooldown - dt);

    switch (this.phase) {
      case 'idle':
        if (this.modal) break; // a panel is open: stand still
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
        if (t >= 1 && !this.castAnimationDone) {
          this.castAnimationDone = true;
          if (!this.baitRequestPending) this.land();
        }
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
          this.recordEscape();
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
          this.recordEscape();
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
    if (this.nearShop()) {
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

    const requestId = ++this.castRequestId;
    this.baitIdBeforeCast = store.data.baitId;
    this.baitRequestPending = true;
    this.castAnimationDone = false;
    this.target = target;
    const tip = this.rodTip();
    this.bobber = { x: tip.x, y: tip.y };
    this.castT = 0;
    this.phase = 'casting';

    void useBaitOnline().then((result) => {
      if (requestId !== this.castRequestId) return;
      store.data.baitId = result.baitId;
      if (result.usedBaitId !== 'dough') store.data.bait[result.usedBaitId] = result.quantity;
      store.data.stats.casts++;
      this.baitRequestPending = false;
      if (result.usedBaitId === 'dough' && this.baitIdBeforeCast !== 'dough') {
        this.showToast('Out of bait. Switched to dough.', '#ffd34d');
      }
      if (this.castAnimationDone && this.phase === 'casting') this.land();
    }).catch((error: unknown) => {
      if (requestId !== this.castRequestId) return;
      this.baitRequestPending = false;
      if (this.phase === 'casting') {
        this.resetToIdle();
        this.showToast(error instanceof Error ? `Cast failed: ${error.message}` : 'Cast failed', '#ff9a8a');
      }
    });
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
    this.castRequestId++;
    this.castAnimationDone = false;
    this.baitRequestPending = false;
    this.hooked = null;
    this.phase = 'idle';
  }

  private finishCatch(_fish: FishDef): void {
    const quality = reelQuality(this.reel);
    this.phase = 'result';
    this.popupReadyAt = Number.POSITIVE_INFINITY;
    const previousXp = store.data.xp;
    void recordCatchOnline(this.map.id, this.zone.id, quality).then((result) => {
      const fish = FISH_BY_ID[result.catch.fishId];
      if (!fish) throw new Error(`Unknown fish returned by server: ${result.catch.fishId}`);
      const prior = store.data.book[fish.id];
      store.data.inventory.push({
        id: result.catch.id,
        fishId: fish.id,
        size: result.catch.size,
        quality: result.catch.quality,
        value: result.catch.value,
      });
      store.data.book[fish.id] = {
        count: (prior?.count ?? 0) + 1,
        bestSize: Math.max(prior?.bestSize ?? 0, result.catch.size),
      };
      store.data.xp += result.xpGained;
      store.data.stats.catches++;
      net.announceCatch(fish.name, fish.rarity, result.catch.size);
      this.popupReadyAt = this.now() + 450;
      this.showCatchPopup(fish, result.catch.size, result.catch.quality, {
        value: result.catch.value,
        isNew: !prior,
        isRecord: !!prior && result.catch.size > prior.bestSize,
        leveledUp: levelOf(store.data.xp) > levelOf(previousXp),
      });
    }).catch((error: unknown) => {
      this.resetToIdle();
      this.showToast(error instanceof Error ? `Catch could not be saved: ${error.message}` : 'Catch could not be saved', '#ff9a8a', 2800);
    });
  }

  private recordEscape(): void {
    void recordEscapeOnline().then(
      () => {
        store.data.stats.escapes++;
      },
      (error: unknown) => this.showToast(error instanceof Error ? `Escape could not be saved: ${error.message}` : 'Escape could not be saved', '#ff9a8a'),
    );
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
      net.onWorldChat((message) => {
        window.dispatchEvent(new CustomEvent('pixel-fishing:world-chat-message', { detail: message }));
      }),
      net.onWorldChatStatus((online) => {
        const text = online
          ? 'World chat connected.'
          : net.worldChatError || (net.status === 'error' ? net.detail : net.online ? 'World chat is reconnecting…' : 'Connect to the game server to use world chat.');
        window.dispatchEvent(new CustomEvent('pixel-fishing:world-chat-status', { detail: { text } }));
      }),
    );

    const token = getGameToken();
    if (net.enabled && token) {
      net.setPositionProvider(() => ({ x: this.px, y: this.py }));
      void net.join({ mapId: this.map.id, code: '', token, x: this.px, y: this.py });
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
    if (net.status === 'online') {
      const ping = net.rtt ? `  ${net.rtt}ms` : '';
      this.netText.setText(`Online: ${net.playerCount} here${ping}`).setColor('#a6e36a');
    } else if (net.status === 'connecting') {
      this.netText.setText(net.detail || 'Connecting...').setColor('#ffd34d');
    } else {
      this.netText.setText(net.detail || 'Offline').setColor('#ff9a8a');
    }
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.modal) {
      this.modal.panel.key(ev.code);
      return;
    }
    if (this.chatInput || !net.online) return;
    if (ev.code === 'Enter' || ev.code === 'NumpadEnter') this.openChat();
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(ev.code);
    if (n >= 0) net.sendEmote(n);
  }

  /** Focus the persistent chat input. Enter focuses it; Escape only blurs it. */
  private openChat(): void {
    if (this.phase === 'result') return;
    this.input.keyboard?.resetKeys();
    this.chatInput = document.getElementById('world-chat-input') as HTMLInputElement | null;
    if (!this.chatInput) return;
    const text = net.worldChatOnline
      ? 'Chat with anglers on every map.'
      : net.worldChatError || (net.status === 'error' ? net.detail : net.online ? 'World chat is connecting…' : 'Connect to the game server to use world chat.');
    window.dispatchEvent(new CustomEvent('pixel-fishing:world-chat-status', { detail: { text } }));
    window.dispatchEvent(new CustomEvent('pixel-fishing:world-chat-open'));
  }

  private closeChat(): void {
    if (!this.chatInput) return;
    this.chatInput = null;
    window.dispatchEvent(new CustomEvent('pixel-fishing:world-chat-close'));
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

    const hh = String(Math.floor(hour)).padStart(2, '0');
    this.hud.update(
      {
        mapName: this.map.name,
        level,
        xpInto: into,
        xpNeed: need,
        coins: d.coins,
        clock: `${hh}:00 ${timeOfDay(hour)}, ${weatherAt(world)}`,
        rodName: currentRod(d).name,
        baitId: bait.id,
        baitName: bait.name,
        baitCount: bait.id === 'dough' ? Infinity : (d.bait[bait.id] ?? 0),
        bagCount: d.inventory.length,
        bagValue: bagValue(d.inventory),
      },
      this.vw,
      this.vh,
    );

    const hints: Record<Phase, string> = {
      idle: this.modal
        ? 'UP/DOWN select | ENTER confirm | ESC close'
        : net.online
          ? 'WASD move | SPACE fish | E use | P boat | O tent | I bag | B bait | M map | ENTER chat'
          : 'WASD move | SPACE fish / shop | E use | P boat | O tent | I bag | B bait | M map',
      charging: 'Release SPACE to cast!',
      casting: this.castAnimationDone && this.baitRequestPending ? 'Confirming bait...' : '',
      waiting: 'Waiting for a bite...  (SPACE to reel in)',
      bite: 'HOOK IT! Press SPACE / click!',
      reeling: 'Hold SPACE / click to raise the bar. Keep the fish inside!',
      result: this.popupReadyAt === Number.POSITIVE_INFINITY ? 'Saving catch...' : '',
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
