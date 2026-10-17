/**
 * Local Database — IndexedDB-based storage for offline market data
 * 
 * Stores:
 *   5. chainSnapshots / dailyStats — snapshot recorder (see snapshotStore.ts)
 *   1. Instruments — F&O stock master (symbol, securityId, lotSize, exchangeSegment)
 *   2. Price Snapshots — Latest known prices for all instruments  
 *   3. Candle History — 1-2 days of intraday OHLCV candles for charts
 *   4. Metadata — Last update timestamps, version info
 * 
 * Uses IndexedDB for large data (localStorage has 5MB limit).
 *
 * Versions: v3 added chainSnapshots and dailyStats; v4 stores chain snapshots column-wise
 * (src/lib/history/columnar.ts) and migrates existing v3 row-object records in the upgrade.
 */
import { migrateRecord } from "@/lib/history/columnar";

// ── Types ──

export interface Instrument {
  securityId: string;
  symbol: string;
  tradingSymbol: string;
  exchangeSegment: string;
  instrumentType: string;
  lotSize: number;
  expiryDate?: string;
  strikePrice?: number;
  optionType?: string;
}

export interface PriceSnapshot {
  securityId: string;
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  oi: number;
  timestamp: number;
}

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi?: number;
}

export interface CandleHistory {
  securityId: string;
  symbol: string;
  exchangeSegment: string;
  interval: string; // "5" = 5min candles
  candles: CandleData[];
  lastUpdated: number;
}

export interface DatabaseMetadata {
  key: string;
  value: string;
  updatedAt: number;
}

// ── IndexedDB Manager ──

export const DB_NAME = "mrchartist_market_db";
/** v3 adds the chainSnapshots and dailyStats stores; v4 makes chain snapshots columnar. */
export const DB_VERSION = 4;

export const STORE_CHAIN_SNAPSHOTS = "chainSnapshots";
export const STORE_DAILY_STATS = "dailyStats";

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/** True when IndexedDB exists in this environment (false in node tests and some private windows). */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

/** Open (or reuse) the shared market database. */
export function openMarketDB(): Promise<IDBDatabase> {
  return openDB();
}

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbPromise) return dbPromise;
  if (!isIndexedDBAvailable()) return Promise.reject(new Error("IndexedDB is not available"));

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const upgradeTx = (event.target as IDBOpenDBRequest).transaction;
      const oldVersion = event.oldVersion;

      // Instruments store
      if (!db.objectStoreNames.contains("instruments")) {
        const instrumentStore = db.createObjectStore("instruments", { keyPath: "securityId" });
        instrumentStore.createIndex("symbol", "symbol", { unique: false });
        instrumentStore.createIndex("exchangeSegment", "exchangeSegment", { unique: false });
        instrumentStore.createIndex("instrumentType", "instrumentType", { unique: false });
      }

      // Price snapshots
      if (!db.objectStoreNames.contains("prices")) {
        const priceStore = db.createObjectStore("prices", { keyPath: "securityId" });
        priceStore.createIndex("symbol", "symbol", { unique: false });
      }

      // Candle history
      if (!db.objectStoreNames.contains("candles")) {
        const candleStore = db.createObjectStore("candles", { keyPath: ["securityId", "interval"] });
        candleStore.createIndex("symbol", "symbol", { unique: false });
      }

      // Metadata
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata", { keyPath: "key" });
      }

      // v3: intraday option-chain snapshots (one record per symbol/expiry/timestamp)
      if (!db.objectStoreNames.contains(STORE_CHAIN_SNAPSHOTS)) {
        const snap = db.createObjectStore(STORE_CHAIN_SNAPSHOTS, { keyPath: "id" });
        snap.createIndex("symbolExpiryTs", ["symbol", "expiry", "ts"], { unique: false });
        snap.createIndex("ts", "ts", { unique: false });
        snap.createIndex("symbol", "symbol", { unique: false });
      }

      // v3: end-of-day stats (one record per symbol/date)
      if (!db.objectStoreNames.contains(STORE_DAILY_STATS)) {
        const daily = db.createObjectStore(STORE_DAILY_STATS, { keyPath: ["symbol", "date"] });
        daily.createIndex("symbol", "symbol", { unique: false });
      }

      // v4: rewrite v3 row-object snapshots in the columnar format, inside the upgrade transaction.
      if (oldVersion >= 3 && oldVersion < 4 && upgradeTx) {
        migrateSnapshotsToColumnar(upgradeTx);
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      // Another tab upgraded the schema: close so it can proceed, reopen lazily next time.
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      };
      resolve(dbInstance);
    };

    request.onblocked = () => {
      console.warn("[localDatabase] Upgrade blocked by another open tab; close other tabs of the terminal.");
    };

    request.onerror = () => {
      dbPromise = null;
      reject(new Error("Failed to open IndexedDB"));
    };
  });
  return dbPromise;
}

/** Convert every legacy chain snapshot in the store to the columnar format (cursor walk). */
export function migrateSnapshotsToColumnar(tx: IDBTransaction): void {
  const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).openCursor();
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    try {
      const next = migrateRecord(cur.value);
      if (next) cur.update(next);
    } catch {
      // An unreadable record must not abort the whole upgrade: drop it instead.
      cur.delete();
    }
    cur.continue();
  };
}

/** Close the shared connection (tests, and before deleting the database). */
export function closeMarketDB(): void {
  try {
    dbInstance?.close();
  } catch {
    /* already closed */
  }
  dbInstance = null;
  dbPromise = null;
}

// ── Generic CRUD operations ──

async function putItem<T>(storeName: string, item: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putItems<T>(storeName: string, items: T[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getItem<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

async function getAllItems<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function getItemsByIndex<T>(storeName: string, indexName: string, value: IDBValidKey | IDBKeyRange): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const index = tx.objectStore(storeName).index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function countItems(storeName: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Public API ──

// Instruments
export const saveInstruments = (items: Instrument[]) => putItems("instruments", items);
export const getInstrument = (securityId: string) => getItem<Instrument>("instruments", securityId);
export const getAllInstruments = () => getAllItems<Instrument>("instruments");
export const getInstrumentsBySegment = (segment: string) => getItemsByIndex<Instrument>("instruments", "exchangeSegment", segment);
export const getInstrumentsByType = (type: string) => getItemsByIndex<Instrument>("instruments", "instrumentType", type);
export const clearInstruments = () => clearStore("instruments");
export const countInstruments = () => countItems("instruments");

// Instrument lookup by symbol
export async function findInstrumentBySymbol(symbol: string): Promise<Instrument | undefined> {
  const results = await getItemsByIndex<Instrument>("instruments", "symbol", symbol);
  return results[0];
}

// Get all F&O stocks (unique equity symbols in NSE_FNO segment)
export async function getFnOStockList(): Promise<Instrument[]> {
  const fnoInstruments = await getInstrumentsBySegment("NSE_FNO");
  // Get unique underlying symbols (FUTSTK type gives us the stock names)
  const seen = new Set<string>();
  return fnoInstruments
    .filter((i) => {
      if (i.instrumentType === "FUTSTK" && !seen.has(i.symbol)) {
        seen.add(i.symbol);
        return true;
      }
      return false;
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// Prices
export const savePriceSnapshot = (item: PriceSnapshot) => putItem("prices", item);
export const savePriceSnapshots = (items: PriceSnapshot[]) => putItems("prices", items);
export const getPriceSnapshot = (securityId: string) => getItem<PriceSnapshot>("prices", securityId);
export const getAllPriceSnapshots = () => getAllItems<PriceSnapshot>("prices");
export const clearPrices = () => clearStore("prices");
export const countPrices = () => countItems("prices");

// Get price by symbol
export async function getPriceBySymbol(symbol: string): Promise<PriceSnapshot | undefined> {
  const results = await getItemsByIndex<PriceSnapshot>("prices", "symbol", symbol);
  return results[0];
}

// Candle history
export const saveCandleHistory = (item: CandleHistory) => putItem("candles", item);
export const getCandleHistory = (securityId: string, interval: string) =>
  getItem<CandleHistory>("candles", [securityId, interval]);
export const getAllCandleHistories = () => getAllItems<CandleHistory>("candles");
export const clearCandles = () => clearStore("candles");
export const countCandles = () => countItems("candles");

// Metadata
export const setMetadata = (key: string, value: string) =>
  putItem("metadata", { key, value, updatedAt: Date.now() } as DatabaseMetadata);
export const getMetadata = (key: string) => getItem<DatabaseMetadata>("metadata", key);

// ── Database Stats ──

export interface DatabaseStats {
  instruments: number;
  prices: number;
  candles: number;
  lastInstrumentUpdate: string | null;
  lastPriceUpdate: string | null;
  lastCandleUpdate: string | null;
}

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const [instruments, prices, candles, instrMeta, priceMeta, candleMeta] = await Promise.all([
    countInstruments(),
    countPrices(),
    countCandles(),
    getMetadata("lastInstrumentUpdate"),
    getMetadata("lastPriceUpdate"),
    getMetadata("lastCandleUpdate"),
  ]);

  return {
    instruments,
    prices,
    candles,
    lastInstrumentUpdate: instrMeta?.value || null,
    lastPriceUpdate: priceMeta?.value || null,
    lastCandleUpdate: candleMeta?.value || null,
  };
}

// ── Clear entire database ──

export async function clearAllData(): Promise<void> {
  await Promise.all([clearInstruments(), clearPrices(), clearCandles()]);
}

/** Clear the snapshot recorder stores (chain snapshots and daily stats). */
export async function clearSnapshotData(): Promise<void> {
  await Promise.all([clearStore(STORE_CHAIN_SNAPSHOTS), clearStore(STORE_DAILY_STATS)]);
}

export const countChainSnapshots = () => countItems(STORE_CHAIN_SNAPSHOTS);
export const countDailyStats = () => countItems(STORE_DAILY_STATS);
