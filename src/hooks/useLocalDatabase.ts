/**
 * useLocalDatabase — React hooks over the local IndexedDB store
 * 
 * Provides useStorageHealth(): browser storage usage, quota and the snapshot-recording pause state.
 */

import { useState, useEffect } from "react";
import { getStorageHealth, refreshStorageHealth, subscribeStorageHealth, type StorageHealth } from "@/lib/history/storageHealth";

// ── Hook: Browser storage health (usage, quota, persistence, recording pause) ──

/** Live storage health. Measures once on mount (and requests persistent storage), then follows changes. */
export function useStorageHealth(): StorageHealth {
  const [health, setHealth] = useState<StorageHealth>(() => getStorageHealth());
  useEffect(() => {
    const off = subscribeStorageHealth(setHealth);
    void refreshStorageHealth();
    return off;
  }, []);
  return health;
}
