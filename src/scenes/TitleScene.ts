import Phaser from 'phaser';
import { MAPS } from '../data/maps';
import { mulberry32 } from '../logic/rng';
import { hasSave, loadGame, resetGame, store } from '../save/storage';
import { MULTIPLAYER_AVAILABLE } from '../net/config';
import { net } from '../net/NetClient';
import { getCode, getName, getOnline, setCode, setName, setOnline } from '../net/prefs';
import { cleanName, normalizeCode } from '../net/protocol';
import { button, txt } from '../ui/ui';
import { ensureTextures, WATER_FRAMES } from '../world/art';

const TILE = 16;
const PANEL_W = 124;
const MAP = MAPS[0];

type Cell = 'grass' | 'water' | 'deep' | 'sand' | 'wood';

/**
 * Animated top-down title screen built from the game's own tiles: a pond with a dock, the angler,
 * an angler who waits a long while, then hooks, reels in and casts again, and drifting cloud shadows, with the menu in a panel on the left.
 */
export class TitleScene extends Phaser.Scene {
  private vw = 0;
  private vh = 0;
  private confirmReset = false;
  private waterImgs: { img: Phaser.GameObjects.Image; key: string; ph: number }[] = [];
  private waterTick = 0;
  private fx!: Phaser.GameObjects.Graphics;
  private bang!: Phaser.GameObjects.Text;
  private angler = { x: 0, y: 0, bx: 0, by: 0 };
  private resizeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super('Title');
  }

  create(): void {
    loadGame();
    this.confirmReset = false;
    this.waterImgs = [];
    this.waterTick = 0;

    const w = this.scale.width;
    const h = this.scale.height;
    const z = Math.max(2, Math.round(h / 225));
    this.vw = w / z;
    this.vh = h / z;
    this.cameras.main.setBackgroundColor(0x3f7a3a).setZoom(z).centerOn(this.vw / 2, this.vh / 2);

    net.leave(); // coming back to the title always drops the connection
    ensureTextures(this, MAP);
    this.buildScene();
    this.buildMenu();
    this.buildOnlinePanel();

    this.time.addEvent({
      delay: 130,
      loop: true,
      callback: () => {
        this.waterTick++;
        for (const wi of this.waterImgs) wi.img.setTexture(`${wi.key}_${(this.waterTick + wi.ph) % WATER_FRAMES}`);
      },
    });

    const start = () => this.go();
    this.input.keyboard?.once('keydown-SPACE', start);
    this.input.keyboard?.once('keydown-ENTER', start);
    this.input.keyboard?.on('keydown-F', this.toggleFullscreen, this);

    const onResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        if (this.scene.isActive()) this.scene.restart();
      }, 150);
    };
    this.scale.on('resize', onResize);
    this.events.once('shutdown', () => {
      clearTimeout(this.resizeTimer);
      this.scale.off('resize', onResize);
      this.input.keyboard?.off('keydown-F', this.toggleFullscreen, this);
    });
  }

  private toggleFullscreen(): void {
    if (this.scale.isFullscreen) this.scale.stopFullscreen();
    else this.scale.startFullscreen();
  }

  // ---- backdrop -------------------------------------------------------------

  private buildScene(): void {
    const cols = Math.ceil(this.vw / TILE) + 1;
    const rows = Math.ceil(this.vh / TILE) + 1;
    const rng = mulberry32(7);
    const hash = (x: number, y: number, n: number) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % n;

    const cx = cols * 0.64;
    const cy = rows * 0.54;
    const rx = Math.min(cols * 0.27, 12);
    const ry = Math.min(rows * 0.3, 8);

    const grid: Cell[][] = [];
    for (let y = 0; y < rows; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < cols; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const a = Math.atan2(dy, dx);
        const d = Math.hypot(dx, dy) / (1 + 0.12 * Math.sin(3 * a + 1) + 0.08 * Math.sin(5 * a + 2));
        row.push(d < 0.5 ? 'deep' : d < 1 ? 'water' : d < 1.18 ? 'sand' : 'grass');
      }
      grid.push(row);
    }

    // dock from the left shore into the lake
    const ty = Math.round(cy);
    let firstWater = 0;
    while (firstWater < cols - 1 && grid[ty][firstWater] !== 'water' && grid[ty][firstWater] !== 'deep') firstWater++;
    const dockEnd = Math.min(cols - 1, firstWater + 3);
    for (let x = Math.max(0, firstWater - 1); x <= dockEnd; x++) grid[ty][x] = 'wood';

    const place = (key: string, x: number, y: number) => this.add.image(x * TILE, y * TILE, key).setOrigin(0, 0);
    const foam = this.add.graphics().setDepth(1);
    const isLand = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && (grid[y][x] === 'grass' || grid[y][x] === 'sand');

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const c = grid[y][x];
        if (c === 'water' || c === 'deep') {
          const key = `${c === 'deep' ? 'deep' : 'water'}_${MAP.id}`;
          const ph = (x + y * 3) % WATER_FRAMES;
          this.waterImgs.push({ img: place(`${key}_${ph}`, x, y), key, ph });
          foam.fillStyle(0xffffff, 0.5);
          if (isLand(x, y - 1)) foam.fillRect(x * TILE, y * TILE, TILE, 2);
          if (isLand(x, y + 1)) foam.fillRect(x * TILE, y * TILE + TILE - 2, TILE, 2);
          if (isLand(x - 1, y)) foam.fillRect(x * TILE, y * TILE, 2, TILE);
          if (isLand(x + 1, y)) foam.fillRect(x * TILE + TILE - 2, y * TILE, 2, TILE);
        } else if (c === 'sand') place(`sand_${hash(x, y, 2)}`, x, y);
        else if (c === 'wood') place('wood', x, y).setDepth(4);
        else place(`grass_${MAP.id}_${hash(x, y, 3)}`, x, y);
      }
    }

    // scenery on the grass, keeping the dock approach clear
    const panelTiles = Math.ceil((PANEL_W + 12) / TILE);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== 'grass') continue;
        if (Math.abs(y - ty) <= 1 && x <= firstWater) continue;
        const border = x < 1 || y < 1 || x >= cols - 1 || y >= rows - 1;
        const r = rng();
        if (border ? r < 0.8 : x < panelTiles ? r < 0.04 : r < 0.07) {
          this.add.image(x * TILE, (y + 1) * TILE, `tree_${MAP.id}`).setOrigin(0, 1).setDepth((y + 1) * TILE);
        } else if (r < 0.09) place('rock', x, y).setDepth((y + 1) * TILE);
        else if (r < 0.15) place(`flower_${Math.floor(rng() * 3)}`, x, y).setDepth(2);
      }
    }

    // angler standing at the end of the dock, casting to the right
    const ax = dockEnd * TILE + TILE / 2;
    const ay = (ty + 1) * TILE - 2;
    this.add.image(ax, ay, 'p_right_0').setOrigin(0.5, 1).setDepth(ay);
    this.angler = { x: ax, y: ay, bx: (dockEnd + 4) * TILE + TILE / 2, by: ty * TILE + TILE / 2 };

    this.fx = this.add.graphics().setDepth(5000);
    this.bang = txt(this, 0, 0, '!', 12, '#ffef5a', 0.5, 1).setDepth(5001).setVisible(false);
  }

  // ---- menu -------------------------------------------------------------------

  private buildMenu(): void {
    const x0 = 10;
    const top = 10;
    const bottom = this.vh - 10;
    const depth = 9000;

    const panel = this.add.graphics().setDepth(depth);
    panel.fillStyle(0x3b2818, 0.82);
    panel.fillRect(x0, top, PANEL_W, bottom - top);
    panel.lineStyle(1, 0xd9b074, 0.9);
    panel.strokeRect(x0 + 0.5, top + 0.5, PANEL_W - 1, bottom - top - 1);
    panel.fillStyle(0x000000, 0.18);
    for (let y = top + 16; y < bottom - 2; y += 16) panel.fillRect(x0 + 2, y, PANEL_W - 4, 1);
    panel.fillStyle(0xd9b074, 0.25);
    panel.fillRect(x0 + 4, top + 4, PANEL_W - 8, 1);

    const cx = x0 + PANEL_W / 2;
    const shadowTxt = (y: number, s: string, size: number, color: string) => {
      const sh = txt(this, cx + 1, y + 1.5, s, size, '#000000', 0.5).setDepth(depth + 1).setAlpha(0.6);
      const t = txt(this, cx, y, s, size, color, 0.5).setDepth(depth + 2);
      return [sh, t];
    };
    const logo = [...shadowTxt(26, 'PIXEL', 22, '#ffe9a8'), ...shadowTxt(48, 'FISHING', 22, '#a6e36a')];
    this.tweens.add({ targets: logo, y: '+=2', duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    txt(this, cx, 77, 'a cozy fishing adventure', 6, '#e8d8b0', 0.5).setDepth(depth + 1);

    const bw = PANEL_W - 20;
    const bx = x0 + 10;
    let by = Math.max(94, this.vh * 0.42);
    const lift = (b: ReturnType<typeof button>) => b.container.setDepth(depth + 3);

    const hasData = hasSave();
    lift(button(this, bx, by, bw, 20, hasData ? 'Continue' : 'Start', () => this.go()));
    by += 24;

    if (hasData) {
      const reset = button(this, bx, by, bw, 20, 'New game', () => {
        if (!this.confirmReset) {
          this.confirmReset = true;
          reset.setLabel('Sure? Click again');
          return;
        }
        resetGame();
        this.go();
      });
      lift(reset);
      by += 24;
    }

    lift(button(this, bx, by, bw, 20, 'Fullscreen (F)', () => this.toggleFullscreen()));

    txt(this, cx, bottom - 44, 'WASD  move\nSPACE fish / shop', 6, '#cdb98f', 0.5, 0).setDepth(depth + 1).setAlign('center');
    txt(this, cx, bottom - 8, 'press SPACE to start', 6, '#ffe9a8', 0.5, 1).setDepth(depth + 1);
  }

  // ---- multiplayer panel ------------------------------------------------------------

  private nameInput: HTMLInputElement | null = null;
  private codeInput: HTMLInputElement | null = null;

  private go(): void {
    this.savePrefs();
    this.scene.start('Fishing', { mapId: store.data.lastMap });
  }

  private savePrefs(): void {
    if (this.nameInput) setName(cleanName(this.nameInput.value));
    if (this.codeInput) setCode(normalizeCode(this.codeInput.value));
  }

  /** Name, room code, online toggle and server status, bottom right. */
  private buildOnlinePanel(): void {
    const w = 134;
    const h = 86;
    const x = this.vw - 10 - w;
    const y = this.vh - 10 - h;
    const depth = 9000;

    const g = this.add.graphics().setDepth(depth);
    g.fillStyle(0x3b2818, 0.85);
    g.fillRect(x, y, w, h);
    g.lineStyle(1, 0xd9b074, 0.9);
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    txt(this, x + 6, y + 4, 'MULTIPLAYER', 6, '#ffe9a8').setDepth(depth + 1);

    if (!MULTIPLAYER_AVAILABLE) {
      txt(this, x + 6, y + 18, 'No server is set up for\nthis build, so the game\nruns single-player.', 6, '#cdb98f').setDepth(depth + 1);
      return;
    }

    // HTML text fields sit over the canvas; their position follows the canvas size and zoom
    const rect = this.game.canvas.getBoundingClientRect();
    const k = (this.cameras.main.zoom * rect.width) / this.scale.width;
    const field = (ly: number, value: string, placeholder: string, max: number): HTMLInputElement => {
      const el = document.createElement('input');
      el.type = 'text';
      el.value = value;
      el.placeholder = placeholder;
      el.maxLength = max;
      el.autocomplete = 'off';
      el.spellcheck = false;
      Object.assign(el.style, {
        position: 'fixed',
        left: `${rect.left + (x + 6) * k}px`,
        top: `${rect.top + (y + ly) * k}px`,
        width: `${(w - 12) * k}px`,
        height: `${13 * k}px`,
        boxSizing: 'border-box',
        padding: `0 ${3 * k}px`,
        font: `${Math.max(9, 6.5 * k)}px monospace`,
        color: '#fff4d6',
        background: '#2b1d10',
        border: '1px solid #d9b074',
        outline: 'none',
        zIndex: '5',
      });
      // typing must not reach the game's own keys (SPACE starts, F is fullscreen)
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') el.blur();
      });
      el.addEventListener('keyup', (e) => e.stopPropagation());
      document.body.appendChild(el);
      return el;
    };

    this.nameInput = field(14, getName(), 'Your name', 16);
    this.codeInput = field(30, getCode(), 'Room code (optional)', 12);
    this.codeInput.addEventListener('input', () => {
      const c = this.codeInput!;
      const clean = normalizeCode(c.value);
      if (clean !== c.value) c.value = clean;
    });

    const toggle = button(this, x + 6, y + 47, w - 12, 15, '', () => {
      setOnline(!getOnline());
      paint();
    });
    toggle.container.setDepth(depth + 2);
    const status = txt(this, x + 6, y + 67, '', 6, '#cdb98f').setDepth(depth + 1);

    const paint = () => {
      toggle.setLabel(getOnline() ? 'Online: ON' : 'Online: OFF');
      if (!getOnline()) status.setText('Playing alone').setColor('#cdb98f');
    };
    paint();

    // wake the server now (a free-tier host sleeps when idle) so it is ready when you press Start
    const cleanup = () => {
      this.nameInput?.remove();
      this.codeInput?.remove();
      this.nameInput = null;
      this.codeInput = null;
    };
    this.events.once('shutdown', cleanup);

    if (getOnline()) {
      status.setText('Checking the server...').setColor('#ffd34d');
      const slow = this.time.delayedCall(3000, () => status.active && getOnline() && status.setText('Waking the server...\n(can take a minute)').setColor('#ffd34d'));
      void net.warmUp().then((ok) => {
        slow.remove();
        if (!status.active || !this.scene.isActive('Title')) return;
        if (!getOnline()) return;
        status.setText(ok ? 'Server ready' : 'Server unreachable').setColor(ok ? '#a6e36a' : '#ff9a8a');
      });
    }
  }

  // ---- animation ------------------------------------------------------------------

  update(time: number): void {
    const t = time / 1000;
    const g = this.fx;
    g.clear();

    // drifting cloud shadows
    g.fillStyle(0x000000, 0.07);
    for (let i = 0; i < 3; i++) {
      const span = this.vw + 160;
      const x = ((t * (6 + i * 3) + i * 170) % span) - 80;
      const y = this.vh * (0.2 + i * 0.3);
      g.fillEllipse(x, y, 90 + i * 20, 36);
      g.fillEllipse(x + 30, y + 10, 60, 28);
    }

    this.drawAngler(t, g);
  }

  /** The angler's loop: wait a long while for a bite, hook it, reel it in, then cast again. */
  private drawAngler(t: number, g: Phaser.GameObjects.Graphics): void {
    const WAIT = 12;
    const BITE = 0.9;
    const REEL = 5;
    const CAST = 0.8;
    const CYCLE = WAIT + BITE + REEL + CAST;
    const clock = t + WAIT; // open on the bite so the reeling is seen straight away
    let e = clock % CYCLE;

    type State = 'wait' | 'bite' | 'reel' | 'cast';
    let state: State;
    let u: number;
    if (e < WAIT) {
      state = 'wait';
      u = e / WAIT;
    } else if ((e -= WAIT) < BITE) {
      state = 'bite';
      u = e / BITE;
    } else if ((e -= BITE) < REEL) {
      state = 'reel';
      u = e / REEL;
    } else {
      state = 'cast';
      u = (e - REEL) / CAST;
    }

    const a = this.angler;
    const handX = a.x + 4;
    const handY = a.y - 9;
    const restX = a.x + 14;
    const restY = a.y - 17;
    const farX = a.bx;
    const nearX = a.x + 20;
    const waterY = a.by;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

    let tipX = restX;
    let tipY = restY;
    let bend = 0; // how far the rod tip is pulled down
    let bx = farX;
    let by = waterY;
    let sag = 8;

    if (state === 'wait') {
      by = waterY + Math.sin(t * 2.4) * 0.8 + Math.pow(Math.max(0, Math.sin(t * 1.3)), 24) * 1.8;
    } else if (state === 'bite') {
      bx = farX + Math.sin(t * 30) * 0.6;
      by = waterY + 1 + Math.abs(Math.sin(t * 20)) * 2.4;
      bend = 1 + Math.sin(t * 25) * 0.8;
    } else if (state === 'reel') {
      const p = u + Math.sin(u * 28) * 0.012; // the line comes in a little unevenly
      bx = farX + (nearX - farX) * p + Math.sin(t * 9) * (1 - p) * 1.6;
      by = waterY + Math.sin(t * 13) * 0.9;
      bend = 3.2 + Math.sin(t * 16) * 1.2;
      tipX += Math.sin(t * 16) * 0.4;
      sag = 1.5;
    } else if (state === 'cast') {
      const lift = Math.sin(clamp01(u / 0.3) * Math.PI);
      tipY -= lift * 5;
      bend = -2 * lift;
      const f = clamp01((u - 0.25) / 0.75);
      if (f <= 0) {
        const l = clamp01(u / 0.25);
        bx = nearX + (restX + 3 - nearX) * l;
        by = waterY + (restY - waterY) * l;
      } else {
        bx = restX + 3 + (farX - restX - 3) * f;
        by = restY + (waterY - restY) * f - Math.sin(f * Math.PI) * 22;
      }
      sag = 3;
    }

    // rod: a curve from the hand to the tip, pulled down by the fish
    const ty = tipY + bend;
    g.lineStyle(2, 0x6b4a2a, 1);
    let lx = handX;
    let ly = handY;
    const cxr = handX + (tipX - handX) * 0.55;
    const cyr = handY + (ty - handY) * 0.55 + bend * 0.8;
    for (let i = 1; i <= 8; i++) {
      const s2 = i / 8;
      const x = (1 - s2) * (1 - s2) * handX + 2 * (1 - s2) * s2 * cxr + s2 * s2 * tipX;
      const y = (1 - s2) * (1 - s2) * handY + 2 * (1 - s2) * s2 * cyr + s2 * s2 * ty;
      g.lineBetween(lx, ly, x, y);
      lx = x;
      ly = y;
    }

    // reel
    g.fillStyle(0x8f949c, 1);
    g.fillCircle(handX + 1, handY + 1, 2.2);
    const ang = state === 'reel' ? t * 14 : 0.6;
    g.fillStyle(0xffe08a, 1);
    g.fillRect(handX + 1 + Math.cos(ang) * 2, handY + 1 + Math.sin(ang) * 2, 1, 1);

    this.bang.setVisible(state === 'bite');

    // line
    g.lineStyle(1, 0xffffff, 0.85);
    lx = tipX;
    ly = ty;
    for (let i = 1; i <= 12; i++) {
      const k = i / 12;
      const x = tipX + (bx - tipX) * k;
      const y = ty + (by - ty) * k + Math.sin(k * Math.PI) * sag;
      g.lineBetween(lx, ly, x, y);
      lx = x;
      ly = y;
    }

    if (state !== 'cast') {
      // ripples around the float; a V-shaped wake while it is being pulled in
      const reeling = state === 'reel';
      for (let i = 0; i < 2; i++) {
        const p = (t * (reeling ? 1.6 : 0.45) + i * 0.5) % 1;
        g.lineStyle(1, 0xffffff, (1 - p) * 0.55);
        g.strokeEllipse(bx, waterY + 2, 6 + p * (reeling ? 14 : 22), 2 + p * (reeling ? 5 : 8));
      }
      if (reeling) {
        g.lineStyle(1, 0xffffff, 0.45);
        g.lineBetween(bx + 2, by + 2, bx + 9, by - 1);
        g.lineBetween(bx + 2, by + 2, bx + 9, by + 5);
      }
      this.bang.setPosition(bx, by - 8);
    }

    g.fillStyle(0xe84a3c, 1);
    g.fillCircle(bx, by, 2.5);
    g.fillStyle(0xffffff, 1);
    g.fillRect(bx - 2, by - 0.5, 4, 1);
  }
}
