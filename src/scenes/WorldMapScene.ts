import Phaser from 'phaser';
import { MAPS } from '../data/maps';
import { levelOf } from '../logic/economy';
import { net } from '../net/NetClient';
import { unlockMapOnline } from '../net/gameApi';
import { store } from '../save/storage';
import type { MapDef } from '../types';
import { button, Button, H, txt, W, fitMenu } from '../ui/ui';

type Deco = 'tree' | 'pine' | 'palm' | 'reed' | 'peak' | 'volcano' | 'crystal' | 'falls' | 'ice' | 'reef' | 'canyon' | 'delta';

interface Theme {
  land: number;
  rim: number;
  deco: Deco;
}

/** Island look per map id. Unknown ids fall back to their water kind. */
const THEMES: Record<string, Theme> = {
  pond: { land: 0x5aa05a, rim: 0x3f7a4a, deco: 'tree' },
  river: { land: 0x4f9a5a, rim: 0x38764a, deco: 'tree' },
  ocean: { land: 0xe3cf94, rim: 0xb59a5a, deco: 'palm' },
  swamp: { land: 0x5f7a3c, rim: 0x41562a, deco: 'reed' },
  'alpine-lake': { land: 0x8fb89a, rim: 0x5d8a6a, deco: 'peak' },
  'pine-reservoir': { land: 0x3f8a52, rim: 0x2a6a3c, deco: 'pine' },
  'coral-reef': { land: 0xf0d9a0, rim: 0xd9a86a, deco: 'reef' },
  'arctic-bay': { land: 0xdbe8f2, rim: 0x9ab8d0, deco: 'ice' },
  'mangrove-marsh': { land: 0x4f7a3a, rim: 0x35562a, deco: 'reed' },
  'volcanic-spring': { land: 0x6a5048, rim: 0x453028, deco: 'volcano' },
  'moonlit-lagoon': { land: 0x7a86c8, rim: 0x4f5a9a, deco: 'palm' },
  'waterfall-gorge': { land: 0x7a8a7a, rim: 0x55655a, deco: 'falls' },
  'canyon-stream': { land: 0xc8764a, rim: 0x9a5030, deco: 'canyon' },
  'crystal-cavern': { land: 0x5a4a7a, rim: 0x3a2f55, deco: 'crystal' },
  'delta-wetlands': { land: 0x6aa078, rim: 0x437a58, deco: 'delta' },
};
const KIND_THEME: Record<string, Theme> = {
  pond: THEMES.pond,
  river: THEMES.river,
  ocean: THEMES.ocean,
  swamp: THEMES.swamp,
  market: { land: 0xd9b074, rim: 0x9a7a4a, deco: 'tree' },
};

const COLS = 5;
const MARGIN_X = 32;
const STEP_X = 58;
const ROW_TOP = 32;
const ROW_BOTTOM = 102;
const MARKET_POS = { x: 296, y: 104 };

/** A stable pseudo-random 0..1 from an integer, so scenery looks hand-placed but never changes. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export class WorldMapScene extends Phaser.Scene {
  private selected: MapDef = MAPS[0];
  private nodes = new Map<string, Phaser.GameObjects.Shape>();
  private positions = new Map<string, { x: number; y: number }>();
  private ring!: Phaser.GameObjects.Arc;
  private you!: Phaser.GameObjects.Graphics;
  private tag!: Phaser.GameObjects.Container;
  private tagText!: Phaser.GameObjects.Text;
  private tagBg!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private desc!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private action!: Button;

  constructor() {
    super('WorldMap');
  }

  create(): void {
    fitMenu(this, 0x1b5586);
    this.nodes.clear();
    this.positions.clear();
    const fishing = MAPS.filter((m) => !m.isMarket);
    const market = MAPS.find((m) => m.isMarket);
    this.selected = MAPS.find((m) => m.id === store.data.lastMap) ?? MAPS[0];

    this.layout(fishing, market);
    this.drawSea();
    this.drawTrail(fishing, market);
    for (const map of fishing) this.drawIsland(map);
    if (market) this.drawIsland(market);
    this.addAmbient();
    this.addNodes(fishing, market);

    // current-selection marker, "you are here" arrow and the floating name tag
    this.ring = this.add.circle(0, 0, 10).setStrokeStyle(1.5, 0xffffff).setDepth(20);
    this.tweens.add({ targets: this.ring, scale: 1.25, alpha: 0.55, duration: 700, yoyo: true, repeat: -1 });
    this.you = this.add.graphics().setDepth(21);
    this.you.fillStyle(0xff5a4a, 1).fillTriangle(-3, -4, 3, -4, 0, 1).lineStyle(1, 0x000000, 1).strokeTriangle(-3, -4, 3, -4, 0, 1);
    this.tweens.add({ targets: this.you, y: '-=3', duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tagBg = this.add.rectangle(0, 0, 10, 10, 0x3b2818, 0.95).setStrokeStyle(1, 0xd9b074);
    this.tagText = txt(this, 0, 0, '', 7, '#ffe9c4', 0.5, 0.5);
    this.tag = this.add.container(0, 0, [this.tagBg, this.tagText]).setDepth(22);

    // how many players are in each map right now (only when online play is on)
    if (net.enabled) {
      const counts = new Map<string, Phaser.GameObjects.Text>();
      for (const map of MAPS) {
        const p = this.positions.get(map.id);
        if (p) counts.set(map.id, txt(this, p.x, p.y + 11, '', 6, '#a6e36a', 0.5, 0).setDepth(19));
      }
      void net.fetchMapCounts().then((list) => {
        if (!list || !this.scene.isActive('WorldMap')) return;
        for (const m of list) {
          const t = counts.get(m.id);
          if (t?.active) t.setText(m.players ? `${m.players} online` : '');
        }
      });
    }

    // info panel
    this.add.rectangle(W / 2, 154, W, 52, 0x3b2818).setStrokeStyle(1, 0xd9b074).setDepth(30);
    this.title = txt(this, 8, 130, '', 10, '#ffe9c4').setDepth(31);
    this.info = txt(this, 8, 144, '', 7, '#a6e36a').setDepth(31);
    this.desc = txt(this, 8, 156, '', 7, '#c8d0d8').setDepth(31);
    this.message = txt(this, 8, 168, '', 7, '#ff9a8a').setDepth(31);
    this.hud = txt(this, 6, 4, '', 8, '#ffffff').setDepth(31);

    this.action = button(this, 226, 134, 88, 18, 'Fish here', () => this.onAction());
    this.action.container.setDepth(32);
    button(this, 226, 156, 42, 16, 'Market', () => this.enterMarket()).container.setDepth(32);
    button(this, 272, 156, 42, 16, 'Book', () => this.scene.start('Book')).container.setDepth(32);
    button(this, 266, 3, 52, 14, 'Title', () => this.scene.start('Title')).container.setDepth(32);

    this.input.keyboard?.on('keydown-LEFT', () => this.step(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => this.step(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.onAction());

    this.refresh();
  }

  /** Winding S-shaped trail: row 1 left to right, row 2 right to left, and so on; the market ends the trail. */
  private layout(fishing: MapDef[], market?: MapDef): void {
    const rows = Math.max(1, Math.ceil(fishing.length / COLS));
    const rowGap = rows > 1 ? (ROW_BOTTOM - ROW_TOP) / (rows - 1) : 0;
    const baseY = rows > 1 ? ROW_TOP : (ROW_TOP + ROW_BOTTOM) / 2;
    fishing.forEach((map, i) => {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const x = MARGIN_X + (row % 2 === 0 ? col : COLS - 1 - col) * STEP_X;
      const wobble = Math.sin(i * 1.7) * 5;
      this.positions.set(map.id, { x, y: Math.round(baseY + row * rowGap + wobble) });
    });
    if (market) {
      const last = fishing.length ? this.positions.get(fishing[fishing.length - 1].id)! : MARKET_POS;
      const farFromLast = Math.hypot(MARKET_POS.x - last.x, MARKET_POS.y - last.y) > 24;
      this.positions.set(market.id, farFromLast ? MARKET_POS : { x: last.x + 30, y: last.y });
    }
  }

  private drawSea(): void {
    this.add.rectangle(W / 2, H / 2, W, H, 0x1b5586);
    const sea = this.add.graphics();
    // lighter bands give the water depth
    sea.fillStyle(0x226a9e, 1).fillRect(0, 0, W, 60);
    sea.fillStyle(0x1f6094, 1).fillRect(0, 60, W, 34);
    // gentle wave dashes
    sea.fillStyle(0xffffff, 0.12);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(hash01(i + 1) * W);
      const y = Math.floor(hash01(i + 91) * 124);
      sea.fillRect(x, y, 4 + Math.floor(hash01(i + 7) * 5), 1);
    }
  }

  private drawTrail(fishing: MapDef[], market?: MapDef): void {
    const path = this.add.graphics().setDepth(5);
    const order = market ? [...fishing, market] : fishing;
    for (let i = 0; i < order.length - 1; i++) {
      const a = this.positions.get(order[i].id)!;
      const b = this.positions.get(order[i + 1].id)!;
      const toMarket = order[i + 1].isMarket === true;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // bow each leg a little so the trail meanders instead of ruling straight lines
      const bow = (i % 2 === 0 ? 1 : -1) * 5;
      const nx = a.y === b.y ? 0 : bow;
      const ny = a.y === b.y ? bow : 0;
      const curve = new Phaser.Curves.QuadraticBezier(
        new Phaser.Math.Vector2(a.x, a.y),
        new Phaser.Math.Vector2(mx + nx, my + ny),
        new Phaser.Math.Vector2(b.x, b.y),
      );
      const pts = curve.getSpacedPoints(Math.max(6, Math.round(curve.getLength() / 5)));
      pts.forEach((p, k) => {
        if (k % 2) return;
        path.fillStyle(toMarket ? 0xffd34d : 0xf6ead0, toMarket ? 0.8 : 0.7).fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      });
    }
  }

  private drawIsland(map: MapDef): void {
    const p = this.positions.get(map.id);
    if (!p) return;
    const theme = THEMES[map.id] ?? KIND_THEME[map.kind] ?? THEMES.pond;
    const seed = map.seed || map.id.length;
    const g = this.add.graphics().setDepth(2);
    const w = 44 + Math.floor(hash01(seed) * 8);
    const h = 28 + Math.floor(hash01(seed + 3) * 6);
    // shallow-water halo, shore, land, highlight
    g.fillStyle(0x4aa3d0, 0.35).fillEllipse(p.x, p.y + 2, w + 10, h + 8);
    g.fillStyle(theme.rim, 1).fillEllipse(p.x, p.y + 1, w, h);
    g.fillStyle(theme.land, 1).fillEllipse(p.x, p.y, w - 5, h - 5);
    g.fillStyle(0xffffff, 0.12).fillEllipse(p.x - 5, p.y - 5, w - 22, h - 16);
    if (map.isMarket) this.drawMarket(g, p.x, p.y);
    else this.drawScenery(g, theme.deco, p.x, p.y, seed);
  }

  private drawMarket(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    // little stall with a striped awning and a flag
    g.fillStyle(0x7a5a36, 1).fillRect(x - 9, y - 4, 18, 9);
    g.fillStyle(0xd94a3a, 1).fillRect(x - 11, y - 8, 22, 5);
    g.fillStyle(0xf6ead0, 1);
    for (let k = -9; k < 11; k += 6) g.fillRect(x + k, y - 8, 3, 5);
    g.fillStyle(0x2f2418, 1).fillRect(x - 3, y, 6, 5);
    g.fillStyle(0x2f2418, 1).fillRect(x + 10, y - 14, 1, 8);
    g.fillStyle(0xffd34d, 1).fillTriangle(x + 11, y - 14, x + 17, y - 12, x + 11, y - 10);
  }

  private drawScenery(g: Phaser.GameObjects.Graphics, deco: Deco, x: number, y: number, seed: number): void {
    // four spots around the map node, nudged by the seed
    const spots = [
      { dx: -15 + Math.floor(hash01(seed + 5) * 3), dy: -3 },
      { dx: 14, dy: -4 + Math.floor(hash01(seed + 9) * 3) },
      { dx: -9, dy: 7 },
      { dx: 10, dy: 7 },
    ];
    spots.forEach((s, i) => {
      const px = x + s.dx;
      const py = y + s.dy;
      switch (deco) {
        case 'tree':
          g.fillStyle(0x6b4a2a, 1).fillRect(px, py + 1, 1, 3);
          g.fillStyle(i % 2 ? 0x2f7a3a : 0x3f8f45, 1).fillCircle(px, py, 3);
          g.fillStyle(0xffffff, 0.15).fillCircle(px - 1, py - 1, 1);
          break;
        case 'pine':
          g.fillStyle(0x2a5a36, 1).fillTriangle(px - 3, py + 3, px + 3, py + 3, px, py - 5);
          g.fillStyle(0x3f8a52, 1).fillTriangle(px - 2, py, px + 2, py, px, py - 6);
          break;
        case 'palm':
          g.fillStyle(0x8a6a3a, 1).fillRect(px, py - 1, 1, 5);
          g.fillStyle(0x3f9a4a, 1).fillEllipse(px - 2, py - 2, 5, 2).fillEllipse(px + 3, py - 2, 5, 2).fillEllipse(px, py - 4, 4, 2);
          break;
        case 'reed':
          g.fillStyle(0x93b04a, 1).fillRect(px, py - 2, 1, 5).fillRect(px + 2, py - 3, 1, 6).fillRect(px - 2, py - 1, 1, 4);
          g.fillStyle(0x6b4a2a, 1).fillRect(px + 2, py - 4, 1, 2);
          break;
        case 'peak':
          g.fillStyle(0x7a8a96, 1).fillTriangle(px - 5, py + 3, px + 5, py + 3, px, py - 6);
          g.fillStyle(0xffffff, 1).fillTriangle(px - 2, py - 2, px + 2, py - 2, px, py - 6);
          break;
        case 'volcano':
          if (i === 0) {
            g.fillStyle(0x3a2a24, 1).fillTriangle(px - 7, py + 4, px + 7, py + 4, px, py - 7);
            g.fillStyle(0xff7a2a, 1).fillTriangle(px - 2, py - 4, px + 2, py - 4, px, py - 8);
            g.fillStyle(0xcfcfcf, 0.7).fillCircle(px + 2, py - 11, 2).fillCircle(px + 4, py - 14, 2);
          } else g.fillStyle(0x2a1f1a, 1).fillCircle(px, py + 1, 2);
          break;
        case 'crystal':
          g.fillStyle(i % 2 ? 0x7ad8ff : 0xc08aff, 1).fillTriangle(px - 2, py + 3, px + 2, py + 3, px, py - 5);
          g.fillStyle(0xffffff, 0.5).fillTriangle(px - 1, py + 1, px, py + 1, px, py - 3);
          break;
        case 'falls':
          if (i === 0) {
            g.fillStyle(0x55655a, 1).fillRect(px - 5, py - 7, 10, 10);
            g.fillStyle(0xeaf6ff, 1).fillRect(px - 1, py - 7, 2, 10).fillRect(px + 2, py - 7, 1, 9);
            g.fillStyle(0x4aa3d0, 1).fillEllipse(px, py + 4, 11, 4);
          } else g.fillStyle(0x3f7a4a, 1).fillCircle(px, py, 2);
          break;
        case 'ice':
          g.fillStyle(i % 2 ? 0xbfe0f4 : 0xffffff, 1).fillTriangle(px - 3, py + 3, px + 3, py + 3, px - 1, py - 4);
          g.fillStyle(0x9ac8e4, 1).fillRect(px - 1, py + 1, 3, 2);
          break;
        case 'reef':
          g.fillStyle(i % 2 ? 0xff7a8a : 0xffa84a, 1).fillCircle(px, py, 2).fillCircle(px + 2, py - 2, 1.5);
          g.fillStyle(0xffffff, 0.35).fillCircle(px - 1, py - 1, 1);
          break;
        case 'canyon':
          g.fillStyle(0x9a5030, 1).fillRect(px - 4, py - 2, 8, 6);
          g.fillStyle(0xd9895a, 1).fillRect(px - 4, py - 2, 8, 2);
          g.fillStyle(0xb86a40, 1).fillRect(px - 4, py + 1, 8, 1);
          break;
        case 'delta':
          g.fillStyle(0x4aa3d0, 1).fillRect(px - 4, py, 9, 1).fillRect(px - 2, py + 2, 5, 1);
          g.fillStyle(0x93b04a, 1).fillRect(px, py - 3, 1, 3);
          break;
      }
    });
  }

  /** Twinkling water, drifting cloud shadows and a small sailboat so the map feels alive. */
  private addAmbient(): void {
    for (let i = 0; i < 18; i++) {
      const s = this.add.rectangle(hash01(i + 40) * W, 4 + hash01(i + 70) * 120, 2, 1, 0xffffff, 0.5).setDepth(3);
      this.tweens.add({ targets: s, alpha: 0.05, duration: 900 + hash01(i) * 1200, yoyo: true, repeat: -1, delay: hash01(i + 3) * 1500 });
    }
    for (let i = 0; i < 3; i++) {
      const c = this.add.ellipse(-30, 24 + i * 38, 54, 14, 0x0a2a4a, 0.13).setDepth(4);
      this.tweens.add({ targets: c, x: W + 40, duration: 36000 + i * 9000, repeat: -1, delay: i * 9000 });
    }
    const boat = this.add.container(-14, 118).setDepth(6);
    const b = this.add.graphics();
    b.fillStyle(0x6b4a2a, 1).fillRect(-5, 0, 10, 3);
    b.fillStyle(0x4a2f1a, 1).fillRect(-4, 3, 8, 1);
    b.fillStyle(0xf6ead0, 1).fillTriangle(0, -9, 0, -1, 5, -1);
    b.fillStyle(0xd94a3a, 1).fillTriangle(0, -9, 0, -1, -4, -1);
    boat.add(b);
    this.tweens.add({ targets: boat, x: W + 14, duration: 30000, repeat: -1 });
    this.tweens.add({ targets: b, y: 1, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private addNodes(fishing: MapDef[], market?: MapDef): void {
    fishing.forEach((map, i) => {
      const p = this.positions.get(map.id)!;
      const node = this.add.circle(p.x, p.y, 6, 0xffd34d).setStrokeStyle(2, 0x000000).setDepth(10);
      this.makeInteractive(node, map);
      this.nodes.set(map.id, node);
      txt(this, p.x, p.y, String(i + 1), 6, '#3b2818', 0.5, 0.5).setDepth(11).setStroke('#ffd34d', 1);
    });
    if (market) {
      const p = this.positions.get(market.id)!;
      const node = this.add.rectangle(p.x, p.y - 1, 24, 18, 0xffffff, 0.001).setDepth(10);
      this.makeInteractive(node, market);
      this.nodes.set(market.id, node);
    }
  }

  private makeInteractive(node: Phaser.GameObjects.Shape, map: MapDef): void {
    node.setInteractive({ useHandCursor: true });
    node.on('pointerdown', () => {
      this.selected = map;
      this.message.setText('');
      this.refresh();
    });
  }

  private step(delta: number): void {
    const list = MAPS;
    const i = list.findIndex((m) => m.id === this.selected.id);
    this.selected = list[(i + delta + list.length) % list.length];
    this.message.setText('');
    this.refresh();
  }

  private refresh(): void {
    const d = store.data;
    this.hud.setText(`Lv ${levelOf(d.xp)}   $${d.coins}   Bag ${d.inventory.length}`);

    const m = this.selected;
    const p = this.positions.get(m.id)!;
    this.ring.setPosition(p.x, p.y);
    const here = this.positions.get(d.lastMap) ?? this.positions.get(MAPS[0].id)!;
    this.you.setPosition(here.x, here.y - 11);

    // floating name tag: above the node, or below it on the top row so it never hits the HUD
    this.tagText.setText(m.name);
    const tw = this.tagText.width + 8;
    this.tagBg.setSize(tw, 11);
    const tx = Phaser.Math.Clamp(p.x, tw / 2 + 2, W - tw / 2 - 2);
    this.tag.setPosition(tx, p.y < 46 ? p.y + 20 : p.y - 17);

    const index = MAPS.filter((x) => !x.isMarket).findIndex((x) => x.id === m.id);
    this.title.setText(m.name);
    this.info.setText(m.isMarket ? 'Shop, restock and meet other anglers' : `Spot ${index + 1} of ${MAPS.filter((x) => !x.isMarket).length}   -   ${m.kind}`);
    this.desc.setText(m.description);
    this.action.setLabel(m.isMarket ? 'Visit market' : 'Fish here');
    this.action.setEnabled(true);
  }

  /** Every map is open to every player; the server grants them, and this is only a safety net. */
  private openMap(map: MapDef): void {
    const d = store.data;
    this.action.setEnabled(false);
    const go = () => {
      d.lastMap = map.id;
      this.scene.start('Fishing', { mapId: map.id });
    };
    if (d.maps.includes(map.id)) return go();
    this.message.setText('Opening map…').setColor('#ffd34d');
    void unlockMapOnline(map.id).then(
      (result) => {
        d.maps.push(result.mapId);
        d.coins = result.coins;
        go();
      },
      (error: unknown) => {
        this.message.setText(error instanceof Error ? error.message : 'Could not open the map').setColor('#ff9a8a');
        this.action.setEnabled(true);
      },
    );
  }

  private onAction(): void {
    this.openMap(this.selected);
  }

  private enterMarket(): void {
    const market = MAPS.find((map) => map.isMarket);
    if (!market) {
      this.message.setText('Market map is not available').setColor('#ff9a8a');
      return;
    }
    this.openMap(market);
  }
}
