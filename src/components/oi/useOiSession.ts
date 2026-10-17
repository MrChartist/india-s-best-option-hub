import { useMemo } from "react";
import { useSnapshots } from "@/hooks/useSnapshotRecorder";
import { latestSessionSnapshots } from "@/lib/oiUtils";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { buildSampleOiSession } from "./sampleOiSession";

/** Recorded snapshots needed before the intraday charts switch from the sample session. */
export const MIN_RECORDED_SNAPSHOTS = 3;

export interface OiSession {
  snaps: ChainSnapshot[];
  /** "recorded": snapshots saved by this browser (or the proxy recorder); "sample": the labelled sample day. */
  source: "recorded" | "sample";
  loading: boolean;
  /** Storage could not be read (IndexedDB blocked); the sample session is shown instead. */
  storageError: boolean;
}

/**
 * The intraday session behind the OI time-series charts: the latest recorded IST session when it
 * has enough snapshots, otherwise a deterministic sample day anchored to the sample chain at the
 * current spot, so the charts are never empty. The source is always returned for labelling.
 */
export function useOiSession(symbol: string, expiry: string, spot: number): OiSession {
  const { data, isLoading, isError } = useSnapshots(symbol, expiry);
  const recorded = useMemo(() => latestSessionSnapshots(data ?? []), [data]);
  const useRecorded = recorded.length >= MIN_RECORDED_SNAPSHOTS;
  // Rebuild the sample at most once a minute and only when spot moves by a meaningful amount.
  const minute = Math.floor(Date.now() / 60_000);
  const spotKey = spot > 0 ? Math.round(spot * 2) / 2 : 0;
  const sample = useMemo(
    () => (useRecorded || !(spotKey > 0) ? [] : buildSampleOiSession({ symbol, expiry, spot: spotKey, now: new Date(minute * 60_000) })),
    [useRecorded, symbol, expiry, spotKey, minute],
  );
  return {
    snaps: useRecorded ? recorded : sample,
    source: useRecorded ? "recorded" : "sample",
    loading: isLoading && !data,
    storageError: isError,
  };
}
