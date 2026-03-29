/**
 * Local Database — IndexedDB-based storage for offline market data
 * 
 * Stores:
 *   1. Instruments — F&O stock master (symbol, securityId, lotSize, exchangeSegment)
 *   2. Price Snapshots — Latest known prices for all instruments  
 *   3. Candle History — 1-2 days of intraday OHLCV candles for charts
 *   4. Metadata — Last update timestamps, version info
 * 
 * Uses IndexedDB for large data (localStorage has 5MB limit).
 */

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

const DB_NAME = "mrchartist_market_db";
const DB_VERSION = 2;

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

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
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };
  });
}

// ── Generic CRUD operations ──

async function putItem(storeName: string, item: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function putItems(storeName: string, items: any[]): Promise<void> {
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

async function getItem<T>(storeName: string, key: any): Promise<T | undefined> {
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

async function getItemsByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
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
