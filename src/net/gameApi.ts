import { defaultSave } from '../logic/economy';
import { session, store } from '../save/storage';
import { setGearCatalog } from '../data/gear';
import { setFishCatalog } from '../data/fish';
import { setMapCatalog } from '../data/maps';
import type { BaitDef, FishDef, MapDef, PlayerPlaceable, RodDef, SaveData } from '../types';
import { GAME_API_AVAILABLE, GAME_API_URL } from './config';

const TOKEN_KEY = 'pixel-fishing-token-v1';
const ACCOUNT_KEY = 'pixel-fishing-account-v1';

export interface GameAccount {
  id: number;
  username: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AuthResponse {
  token: string;
  account: GameAccount;
}

interface ServerSave {
  account: GameAccount;
  coins: number;
  xp: number;
  rod: string;
  baitId: string;
  rods: string[];
  bait: Record<string, number>;
  maps: string[];
  lastMap: string;
  inventory: { id: number; fishId: string; size: number; quality: number; value: number }[];
  book: Record<string, { count: number; bestSize: number }>;
  stats: SaveData['stats'];
  placeables: PlayerPlaceable[];
  position: { x: number; y: number; dir: 'up' | 'down' | 'left' | 'right' } | null;
}

let gameCatalog: GameCatalog | null = null;

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    throw new Error('Browser session storage is unavailable');
  }
}

export function getGameToken(): string | null {
  return readSession(TOKEN_KEY);
}

export function getGameAccount(): GameAccount | null {
  const raw = readSession(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const account = JSON.parse(raw) as GameAccount;
    return Number.isSafeInteger(account.id) && typeof account.username === 'string' ? account : null;
  } catch {
    return null;
  }
}

export function signOut(): void {
  writeSession(TOKEN_KEY, null);
  writeSession(ACCOUNT_KEY, null);
}

async function apiRequest<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  if (!GAME_API_AVAILABLE) throw new Error('Game API is not configured');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (authenticated) {
    const token = getGameToken();
    if (!token) throw new Error('Please sign in first');
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${GAME_API_URL}/${path}`, { ...init, headers });
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`Game API returned an invalid response (HTTP ${response.status})`);
  }
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error || `Game API request failed (HTTP ${response.status})`);
  }
  return payload.data;
}

export async function authenticate(action: 'signup' | 'login', username: string, password: string): Promise<GameAccount> {
  const result = await apiRequest<AuthResponse>(
    `auth.php?action=${action}`,
    { method: 'POST', body: JSON.stringify({ username, password }) },
    false,
  );
  writeSession(TOKEN_KEY, result.token);
  writeSession(ACCOUNT_KEY, JSON.stringify(result.account));
  return result.account;
}

export interface GameCatalog {
  maps: MapDef[];
  tileTypes: { id: number; code: string; label: string; water: boolean; solid: boolean }[];
  fish: FishDef[];
  rods: RodDef[];
  baits: BaitDef[];
  marketItems: MarketItem[];
}

export interface MarketItem {
  id: string;
  name: string;
  kind: 'rod' | 'bait' | 'boat' | 'tent';
  catalogId: string | null;
  price: number;
  description: string;
}

export async function loadGameCatalog(): Promise<GameCatalog> {
  gameCatalog = await apiRequest<GameCatalog>('maps.php', {}, false);
  setMapCatalog(gameCatalog.maps);
  setFishCatalog(gameCatalog.fish);
  setGearCatalog(gameCatalog.rods, gameCatalog.baits);
  return gameCatalog;
}

export function getGameCatalog(): GameCatalog {
  if (!gameCatalog) throw new Error('Game catalog has not been loaded');
  return gameCatalog;
}

export async function refreshPlayerSave(): Promise<void> {
  const { save } = await loadPlayerSave();
  store.data = save;
}

export async function loadPlayerSave(): Promise<{ account: GameAccount; save: SaveData }> {
  const server = await apiRequest<ServerSave>('game.php?action=save');
  const save = defaultSave();
  save.coins = server.coins;
  save.xp = server.xp;
  save.rod = server.rod;
  save.baitId = server.baitId;
  save.rods = server.rods;
  save.bait = server.bait;
  save.maps = server.maps;
  save.lastMap = server.lastMap;
  session.pos = server.position ? { mapId: server.lastMap, ...server.position } : undefined;
  save.inventory = server.inventory.map(({ id, fishId, size, quality, value }) => ({ id, fishId, size, quality, value }));
  save.book = server.book;
  save.stats = server.stats;
  save.placeables = server.placeables;
  return { account: server.account, save };
}

export async function saveCheckpoint(mapId: string, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  await apiRequest('game.php?action=checkpoint', {
    method: 'POST',
    body: JSON.stringify({ mapId, x, y, dir }),
  });
}

export async function buyMarketItem(itemId: string): Promise<{ purchased: string; coins: number }> {
  return apiRequest('game.php?action=buy', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

export async function equipRodOnline(rodId: string): Promise<void> {
  await apiRequest('game.php?action=equip-rod', {
    method: 'POST',
    body: JSON.stringify({ rodId }),
  });
}

export async function equipBaitOnline(baitId: string): Promise<void> {
  await apiRequest('game.php?action=equip-bait', {
    method: 'POST',
    body: JSON.stringify({ baitId }),
  });
}

export async function useBaitOnline(): Promise<{ usedBaitId: string; baitId: string; quantity: number }> {
  return apiRequest('game.php?action=use-bait', { method: 'POST', body: JSON.stringify({}) });
}

export async function recordEscapeOnline(): Promise<void> {
  await apiRequest('game.php?action=escape', { method: 'POST', body: JSON.stringify({}) });
}

export async function unlockMapOnline(mapId: string): Promise<{ mapId: string; coins: number }> {
  return apiRequest('game.php?action=unlock-map', {
    method: 'POST',
    body: JSON.stringify({ mapId }),
  });
}

export async function placeItem(kind: 'boat' | 'tent', mapId: string, tileX: number, tileY: number): Promise<PlayerPlaceable> {
  return apiRequest('game.php?action=place', {
    method: 'POST',
    body: JSON.stringify({ kind, mapId, tileX, tileY }),
  });
}

export interface TentStorage {
  tentId: number;
  catches: { id: number; fishId: string; size: number; quality: number; value: number }[];
  bait: Record<string, number>;
  slotsUsed: number;
  capacity: number;
}

export async function loadTentStorage(tentId: number, mapId: string): Promise<TentStorage> {
  const query = new URLSearchParams({ tentId: String(tentId), mapId });
  return apiRequest<TentStorage>(`game.php?action=tent-storage&${query}`);
}

export interface SharedWorldObject extends PlayerPlaceable {
  ownerId: number;
  ownerName: string;
  ownedByMe: boolean;
}

export async function loadWorldObjects(mapId: string): Promise<SharedWorldObject[]> {
  const query = new URLSearchParams({ mapId });
  const result = await apiRequest<{ objects: SharedWorldObject[] }>(`game.php?action=world&${query}`);
  return result.objects;
}

export async function recordCatchOnline(
  mapId: string,
  zoneId: string,
  quality: number,
): Promise<{ catch: { id: number; fishId: string; size: number; quality: number; value: number }; xpGained: number }> {
  return apiRequest('game.php?action=catch', {
    method: 'POST',
    body: JSON.stringify({ mapId, zoneId, quality }),
  });
}

export async function transferTentItem(
  tentId: number,
  kind: 'fish' | 'bait',
  direction: 'to_tent' | 'to_bag',
  item: { catchId: number } | { baitId: string; quantity: number },
): Promise<void> {
  await apiRequest('game.php?action=transfer', {
    method: 'POST',
    body: JSON.stringify({ tentId, kind, direction, ...item }),
  });
}

export async function packTent(): Promise<void> {
  await apiRequest('game.php?action=pack-tent', { method: 'POST', body: JSON.stringify({}) });
}

export async function sellBagFish(): Promise<{ sold: number; coins: number }> {
  return apiRequest('game.php?action=sell-all', { method: 'POST', body: JSON.stringify({}) });
}
