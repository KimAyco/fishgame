import Phaser from 'phaser';
import { authenticate, loadGameCatalog, loadPlayerSave } from '../net/gameApi';
import { store } from '../save/storage';
import { button, H, txt, W, fitMenu } from '../ui/ui';

export class AuthScene extends Phaser.Scene {
  private usernameInput: HTMLInputElement | null = null;
  private passwordInput: HTMLInputElement | null = null;
  private message!: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super('Auth');
  }

  create(): void {
    fitMenu(this, 0x203c50);
    this.add.rectangle(W / 2, H / 2, W, H, 0x203c50);
    txt(this, W / 2, 20, 'PIXEL FISHING ACCOUNT', 12, '#ffe9c4', 0.5);
    txt(this, W / 2, 38, 'Create an account or sign in to play online.', 7, '#c8d0d8', 0.5);
    this.message = txt(this, W / 2, 133, '', 7, '#ff9a8a', 0.5);
    this.createFields();

    button(this, 48, 96, 92, 20, 'Sign in', () => void this.submit('login'));
    button(this, 180, 96, 92, 20, 'Create account', () => void this.submit('signup'));
    button(this, 136, 151, 48, 16, 'Back', () => this.scene.start('Title'));
    this.events.once('shutdown', () => this.removeFields());
  }

  private createFields(): void {
    const rect = this.game.canvas.getBoundingClientRect();
    const zoom = (this.cameras.main.zoom * rect.width) / this.scale.width;
    const make = (top: number, placeholder: string, type: string): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = type;
      input.placeholder = placeholder;
      input.autocomplete = type === 'password' ? 'current-password' : 'username';
      input.maxLength = type === 'password' ? 128 : 16;
      Object.assign(input.style, {
        position: 'fixed',
        left: `${rect.left + 82 * zoom}px`,
        top: `${rect.top + top * zoom}px`,
        width: `${156 * zoom}px`,
        height: `${18 * zoom}px`,
        boxSizing: 'border-box',
        padding: `0 ${4 * zoom}px`,
        font: `${Math.max(10, 7 * zoom)}px monospace`,
        color: '#fff4d6',
        background: '#2b1d10',
        border: '1px solid #d9b074',
        outline: 'none',
        zIndex: '5',
      });
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') void this.submit('login');
      });
      input.addEventListener('keyup', (event) => event.stopPropagation());
      document.body.appendChild(input);
      return input;
    };
    this.usernameInput = make(57, 'Username (3–16 characters)', 'text');
    this.passwordInput = make(76, 'Password (at least 8 characters)', 'password');
  }

  private async submit(action: 'signup' | 'login'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.message.setText(action === 'signup' ? 'Creating account…' : 'Signing in…').setColor('#ffd34d');
    try {
      await authenticate(action, this.usernameInput?.value ?? '', this.passwordInput?.value ?? '');
      await loadGameCatalog();
      const { save } = await loadPlayerSave();
      store.data = save;
      this.removeFields();
      this.scene.start('Title');
    } catch (error) {
      this.message.setText(error instanceof Error ? error.message : 'Account request failed').setColor('#ff9a8a');
      this.busy = false;
    }
  }

  private removeFields(): void {
    this.usernameInput?.remove();
    this.passwordInput?.remove();
    this.usernameInput = null;
    this.passwordInput = null;
  }
}
