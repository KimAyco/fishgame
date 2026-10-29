import Phaser from 'phaser';
import { BookScene } from './scenes/BookScene';
import { FishingScene } from './scenes/FishingScene';
import { ShopScene } from './scenes/ShopScene';
import { TitleScene } from './scenes/TitleScene';
import { WorldMapScene } from './scenes/WorldMapScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: 'game',
  pixelArt: true,
  backgroundColor: '#0b1020',
  scale: { mode: Phaser.Scale.RESIZE, fullscreenTarget: 'game' },
  scene: [TitleScene, WorldMapScene, FishingScene, ShopScene, BookScene],
});

if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
