import { Client, Room } from 'colyseus.js';
import { syncClock, unsyncClock } from '../logic/clock';
import { MULTIPLAYER_AVAILABLE, SERVER_HTTP_URL, SERVER_WS_URL } from './config';
import type { FishPayload, JoinOptions, MapCount, MovePayload, PlayerState } from './protocol';

/**
 * The game's connection to the realtime server (the Colyseus room "fishing", one per map).
 * It is a plain singleton with no Phaser in it: scenes call `join` / `leave`, send their own
 * position and fishing state, and read the other players back out each frame.
 *
 * Multiplayer is optional. Without a configured server, or when the server cannot be reached,
 * `status` is not 'online' and every method is a harmless no-op, so single-player is unaffected.
 */
export type NetStatus = 'offline' | 'connecting' | 'online' | 'error';

interface RoomState {
  epoch?: number;
  players?: { size: number; forEach(cb: (p: PlayerState, id: string) => void): void };
}

type Listener<T> = (value: T) => void;

/** Render's free tier sleeps when idle and takes up to a minute to wake: keep trying that long. */
const GIVE_UP_AFTER_MS = 90_000;
const SERVER_REJECTED = new Set([4000, 4001, 4002, 4003]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function rejectionDetail(code: number, room: string): string {
  if (code === 4002) {
    return 'The game server rejected your login. Sign out and sign in again; if it continues, check that GAME_AUTH_SECRET matches the game API.';
  }
  if (code === 4003) return 'This account is already connected to this room. Wait a moment and try again.';
  if (code === 4000) return `The game server does not recognize this ${room === 'fishing' ? 'map' : 'room'}.`;
  if (code === 4001) return 'The game server rejected this room code.';
  return `The game server rejected the ${room} room (error ${code}).`;
}

export class NetClient {
  status: NetStatus = 'offline';
  /** short human-readable note to show next to the status */
  detail = '';
  mapId = '';
  code = '';
  /** round-trip time in ms, 0 until measured */
  rtt = 0;

  private client: Client | null = null;
  private room: Room | null = null;
  private worldChatRoom: Room | null = null;
  private attempt = 0;
  private worldChatAttempt = 0;
  private worldChatDetail = '';
  private worldChatRetry: ReturnType<typeof setTimeout> | null = null;
  private lastJoin: JoinOptions | null = null;
  private positionProvider: (() => { x: number; y: number }) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private statusListeners = new Set<Listener<NetStatus>>();
  private emoteListeners = new Set<(id: string, e: number) => void>();
  private chatListeners = new Set<(id: string, name: string, text: string) => void>();
  private worldChatListeners = new Set<(message: { id: string; name: string; text: string; at: number }) => void>();
  private worldChatStatusListeners = new Set<Listener<boolean>>();
  private correctListeners = new Set<Listener<{ x: number; y: number }>>();

  get enabled(): boolean {
    return MULTIPLAYER_AVAILABLE;
  }

  get online(): boolean {
    return this.status === 'online' && this.room !== null;
  }

  get worldChatOnline(): boolean {
    return this.worldChatRoom !== null && this.online;
  }

  get worldChatError(): string {
    return this.worldChatDetail;
  }

  /** This player's id in the room, once joined. */
  get selfId(): string {
    return this.room?.sessionId ?? '';
  }

  /** How many players are in this room, including you. */
  get playerCount(): number {
    return this.state()?.players?.size ?? 0;
  }

  /** Lets a reconnect put you back where you are standing, not where you first joined. */
  setPositionProvider(fn: (() => { x: number; y: number }) | null): void {
    this.positionProvider = fn;
  }

  // ---- connecting ----------------------------------------------------------------------------

  /**
   * Join the room for a map (the public one, or a private one when `code` is set). Leaves the
   * previous room first. Resolves once connected or once it has given up; it never throws.
   */
  async join(opts: JoinOptions): Promise<void> {
    if (!MULTIPLAYER_AVAILABLE) return;
    if (this.online && this.mapId === opts.mapId && this.code === opts.code) return; // already there
    this.dropRoom();
    const attempt = ++this.attempt;
    this.lastJoin = opts;
    this.mapId = opts.mapId;
    this.code = opts.code;
    this.setStatus('connecting', 'Connecting...');

    const started = Date.now();
    let delay = 1500;
    for (let tries = 0; ; tries++) {
      try {
        this.client ??= new Client(SERVER_WS_URL);
        const room = await this.client.joinOrCreate('fishing', opts);
        if (attempt !== this.attempt) {
          room.leave().catch(() => undefined); // the player moved on while we were connecting
          return;
        }
        this.attach(room);
        void this.joinWorldChat(opts.token, attempt);
        return;
      } catch (e) {
        if (attempt !== this.attempt) return;
        const code = (e as { code?: number }).code;
        if (code !== undefined && SERVER_REJECTED.has(code)) {
          this.setStatus('error', rejectionDetail(code, 'fishing'));
          return;
        }
        if (Date.now() - started > GIVE_UP_AFTER_MS) {
          this.setStatus('error', 'Server unreachable');
          return;
        }
        this.setStatus('connecting', tries === 0 ? 'Connecting...' : 'Waking the server, this can take a minute...');
        await sleep(delay);
        if (attempt !== this.attempt) return;
        delay = Math.min(delay + 1500, 6000);
      }
    }
  }

  /** Leave the current room and go back to being offline. */
  leave(): void {
    this.attempt++;
    this.lastJoin = null;
    this.dropRoom();
    this.mapId = '';
    this.code = '';
    this.setStatus('offline', '');
  }

  private attach(room: Room): void {
    this.room = room;
    this.setStatus('online', '');

    room.onMessage('pong', (m: { t: number | null; now: number }) => {
      if (this.room !== room) return;
      const trip = m && typeof m.t === 'number' ? Date.now() - m.t : 0;
      if (trip >= 0) this.rtt = trip;
      const epoch = (room.state as RoomState | undefined)?.epoch;
      if (m && typeof m.now === 'number' && typeof epoch === 'number') syncClock(m.now + this.rtt / 2, epoch);
    });
    room.onMessage('correct', (m: { x: number; y: number }) => this.correctListeners.forEach((f) => f(m)));
    room.onMessage('emote', (m: { id: string; e: number }) => this.emoteListeners.forEach((f) => f(m.id, m.e)));
    room.onMessage('chat', (m: { id: string; name: string; text: string }) => this.chatListeners.forEach((f) => f(m.id, m.name, m.text)));
    room.onError((code, message) => console.warn('[net] room error', code, message));
    room.onLeave((code) => {
      if (this.room !== room) return; // we left on purpose
      this.room = null;
      this.clearTimers();
      unsyncClock();
      if (code === 1000 || code === 4000) {
        this.setStatus('offline', '');
        return;
      }
      this.setStatus('connecting', 'Connection lost, reconnecting...');
      void this.reconnect(room);
    });

    // measure the round trip and learn the server clock quickly, then keep both fresh
    const ping = () => room.send('ping', Date.now());
    this.timers.push(setTimeout(ping, 200), setTimeout(ping, 900));
    this.pingTimer = setInterval(ping, 5000);
  }

  /**
   * After a dropped connection: first try to take the same seat back (the server keeps it for a few
   * seconds, so nobody sees a duplicate), and only if that fails join again from scratch.
   */
  private async reconnect(lost: Room): Promise<void> {
    const attempt = this.attempt;
    const token = lost.reconnectionToken;
    if (token && this.client) {
      try {
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('reconnect timed out')), 5000));
        const room = await Promise.race([this.client.reconnect(token), timeout]);
        if (attempt !== this.attempt) {
          room.leave().catch(() => undefined);
          return;
        }
        this.attach(room);
        return;
      } catch {
        /* the seat is gone or the server is down: fall through to a fresh join */
      }
    }
    if (attempt === this.attempt) this.rejoin();
  }

  private rejoin(): void {
    const last = this.lastJoin;
    if (!last) return;
    const pos = this.positionProvider?.();
    this.lastJoin = null;
    this.mapId = '';
    void this.join(pos ? { ...last, x: pos.x, y: pos.y } : last);
  }

  private dropRoom(): void {
    const room = this.room;
    this.room = null;
    this.worldChatAttempt++;
    if (this.worldChatRetry) clearTimeout(this.worldChatRetry);
    this.worldChatRetry = null;
    const worldChatRoom = this.worldChatRoom;
    this.worldChatRoom = null;
    this.worldChatDetail = '';
    this.setWorldChatStatus(false);
    if (worldChatRoom) worldChatRoom.leave(true).catch(() => undefined);
    this.clearTimers();
    unsyncClock();
    this.rtt = 0;
    if (room) room.leave(true).catch(() => undefined);
  }

  private async joinWorldChat(token: string, attempt: number): Promise<void> {
    const client = this.client;
    if (!client || attempt !== this.attempt || !this.online) return;
    if (this.worldChatRoom) return;
    this.worldChatDetail = '';
    this.setWorldChatStatus(false);
    const chatAttempt = ++this.worldChatAttempt;
    try {
      const room = await client.joinOrCreate('world-chat', { token });
      if (attempt !== this.attempt || chatAttempt !== this.worldChatAttempt || !this.online) {
        room.leave(true).catch(() => undefined);
        return;
      }
      this.worldChatRoom = room;
      this.worldChatDetail = '';
      this.setWorldChatStatus(true);
      room.onMessage('world-chat', (message: { id: string; name: string; text: string; at: number }) => {
        if (this.worldChatRoom === room) this.worldChatListeners.forEach((listener) => listener(message));
      });
      room.onLeave((code) => {
        if (this.worldChatRoom !== room) return;
        this.worldChatRoom = null;
        this.setWorldChatStatus(false);
        if (attempt !== this.attempt || !this.online || code === 1000 || code === 4000) return;
        this.worldChatRetry = setTimeout(() => void this.joinWorldChat(token, attempt), 1500);
      });
      room.onError((code, message) => console.warn('[net] world chat error', code, message));
    } catch (error) {
      if (attempt !== this.attempt || chatAttempt !== this.worldChatAttempt || !this.online) return;
      const code = (error as { code?: number }).code;
      const errorMessage = error instanceof Error ? error.message : '';
      this.worldChatDetail = code !== undefined && SERVER_REJECTED.has(code)
        ? rejectionDetail(code, 'world-chat')
        : errorMessage.includes('GAME_AUTH_SECRET')
          ? 'World chat server authentication is misconfigured. Configure GAME_AUTH_SECRET to match the game API.'
          : '';
      this.setWorldChatStatus(false);
      console.warn('[net] world chat unavailable', error);
      if ((code !== undefined && SERVER_REJECTED.has(code)) || this.worldChatDetail.includes('misconfigured')) return;
      this.worldChatRetry = setTimeout(() => void this.joinWorldChat(token, attempt), 5000);
    }
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  // ---- sending ---------------------------------------------------------------------------------

  sendMove(p: MovePayload): void {
    if (this.online) this.room!.send('move', p);
  }

  sendFish(p: FishPayload): void {
    if (this.online) this.room!.send('fish', p);
  }

  sendEmote(e: number): void {
    if (this.online) this.room!.send('emote', { e });
  }

  sendChat(text: string): boolean {
    if (!this.online || !text.trim()) return false;
    if (!this.worldChatRoom) return false;
    this.room!.send('chat', { text });
    this.worldChatRoom.send('chat', { text });
    return true;
  }

  // ---- reading -----------------------------------------------------------------------------------

  /** Calls `cb` for every other player in the room. */
  forEachRemote(cb: (id: string, p: PlayerState) => void): void {
    const players = this.state()?.players;
    if (!players || !this.online) return;
    const self = this.selfId;
    players.forEach((p, id) => {
      if (id !== self) cb(id, p);
    });
  }

  // ---- events --------------------------------------------------------------------------------------

  onStatus(fn: Listener<NetStatus>): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onEmote(fn: (id: string, e: number) => void): () => void {
    this.emoteListeners.add(fn);
    return () => this.emoteListeners.delete(fn);
  }

  onChat(fn: (id: string, name: string, text: string) => void): () => void {
    this.chatListeners.add(fn);
    return () => this.chatListeners.delete(fn);
  }

  onWorldChat(fn: (message: { id: string; name: string; text: string; at: number }) => void): () => void {
    this.worldChatListeners.add(fn);
    return () => this.worldChatListeners.delete(fn);
  }

  onWorldChatStatus(fn: Listener<boolean>): () => void {
    this.worldChatStatusListeners.add(fn);
    fn(this.worldChatOnline);
    return () => this.worldChatStatusListeners.delete(fn);
  }

  private setWorldChatStatus(online: boolean): void {
    this.worldChatStatusListeners.forEach((listener) => listener(online));
  }

  /** The server moved you back because a position update was too fast to be walking. */
  onCorrect(fn: Listener<{ x: number; y: number }>): () => void {
    this.correctListeners.add(fn);
    return () => this.correctListeners.delete(fn);
  }

  // ---- REST ---------------------------------------------------------------------------------------------

  /** Pings the server so a sleeping free-tier instance starts waking up. True if it answered. */
  async warmUp(): Promise<boolean> {
    if (!MULTIPLAYER_AVAILABLE) return false;
    try {
      const res = await this.fetchJson<{ ok: boolean }>('/health', 60_000);
      return !!res?.ok;
    } catch {
      return false;
    }
  }

  /** Live player counts per map, or null if the server cannot be reached. */
  async fetchMapCounts(): Promise<MapCount[] | null> {
    if (!MULTIPLAYER_AVAILABLE) return null;
    try {
      return await this.fetchJson<MapCount[]>('/api/maps', 5000);
    } catch {
      return null;
    }
  }

  private async fetchJson<T>(path: string, timeoutMs: number): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(SERVER_HTTP_URL + path, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private state(): RoomState | undefined {
    return this.room?.state as RoomState | undefined;
  }

  private setStatus(status: NetStatus, detail: string): void {
    this.detail = detail;
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((f) => f(status));
  }
}

export const net = new NetClient();

// dev only: lets the browser tests reach the live connection
if (import.meta.env.DEV) (window as unknown as { __net: NetClient }).__net = net;
