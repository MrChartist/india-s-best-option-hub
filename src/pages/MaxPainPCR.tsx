import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Loader2, RefreshCw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { SymbolSearch } from "@/components/option-chain/SymbolSearch";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { canonicalSymbol } from "@/components/option-chain/symbols";
import { ExpiryPills } from "@/components/oi/shared";
import { EDU_NOTE, fmtStrike } from "@/components/oi/format";
import { MaxPainCurve } from "@/components/oi/MaxPainCurve";
import { MaxPainTable, type ExpiryRow } from "@/components/oi/MaxPainTable";
import { PCRSuite } from "@/components/oi/PCRSuite";
import { IntradayPCR, MaxPainDrift, PCRHistory } from "@/components/oi/PCRHistory";
import { useChainMulti, useExpiryList, useLiveOptionChain } from "@/hooks/useMarketData";
import { useSnapshotRecorder } from "@/hooks/useSnapshotRecorder";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getMarketParams, normalizeExpiry } from "@/lib/options";
import { expirySummary } from "@/lib/oiUtils";
import type { OptionData } from "@/lib/mockData";

/**
 * Max Pain & PCR: payout curve and max pain across expiries (distance in points, % and expected-move
 * multiples), the PCR family per expiry, intraday PCR vs spot from recorded snapshots, and 60-day
 * end-of-day history with percentile bands.
 */
export default function MaxPainPCR() {
  const [params, setParams] = useSearchParams();
  const symbol = canonicalSymbol(params.get("symbol"));
  const expiryParam = normalizeExpiry(params.get("expiry") || "");
  useDocumentTitle(`Max Pain & PCR · ${symbol}`);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const { data: expiryData } = useExpiryList(symbol);
  const live = useLiveOptionChain(symbol, expiryParam || undefined);
  const multi = useChainMulti(symbol, "all");

  const expiries = useMemo(() => {
    const list = expiryData?.expiries?.length ? expiryData.expiries : live.data?.expiries ?? [];
    return list.filter((e) => !!e.value).map((e) => ({ ...e, value: normalizeExpiry(e.value) || e.value }));
  }, [expiryData, live.data?.expiries]);

  const expiry = expiryParam || live.data?.expiry || expiries[0]?.value || "";
  const chain = useMemo(() => live.data?.chain ?? [], [live.data]);
  const spot = live.data?.spotPrice ?? multi.data?.spot ?? 0;
  const lotSize = live.data?.lotSize ?? 0;
  const liveSample = live.data?.source === "sample";

  useSnapshotRecorder(expiry ? [{ symbol, expiry }] : []);

  const rows = useMemo((): ExpiryRow[] => {
    const { r } = getMarketParams();
    const now = new Date();
    const byExpiry = new Map<string, { chain: OptionData[]; sample: boolean }>();
    for (const e of multi.data?.expiries ?? []) {
      const key = normalizeExpiry(e.expiry) || e.expiry;
      if (key && e.chain.length > 0) byExpiry.set(key, { chain: e.chain, sample: multi.data?.source === "sample" });
    }
    // The selected expiry uses the faster single-expiry feed.
    if (expiry && chain.length > 0) byExpiry.set(expiry, { chain, sample: liveSample });
    return [...byExpiry.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([exp, v]) => ({ ...expirySummary(v.chain, spot, exp, { now, r }), sample: v.sample }));
  }, [multi.data, expiry, chain, liveSample, spot]);

  const current = rows.find((r) => r.expiry === expiry);
  const loading = live.isLoading && !live.data;
  const selectExpiry = (v: string) => setParam({ expiry: v });

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Target}
        eyebrow="Chain & OI"
        title="Max Pain & PCR"
        description="Where option writers lose least at expiry, and how puts stack up against calls."
        source={
          <>
            {live.data && <SourceBadge source={live.data.source} asOf={live.data.asOf} stale={live.data.stale} isLive={live.data.isLive} reason={live.data.reason} />}
            {spot > 0 && (
              <span className="font-num text-xs text-muted-foreground">
                Spot <span className="font-semibold text-foreground">{spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                {current?.maxPain ? (
                  <>
                    {" "}· Max pain <span className="font-semibold text-warning">{fmtStrike(current.maxPain)}</span>
                  </>
                ) : null}
              </span>
            )}
          </>
        }
        actions={
          <>
            <SymbolSearch value={symbol} onSelect={(v) => setParam({ symbol: v, expiry: null })} />
            <Button
              variant="outline"
              size="pill"
              className="h-8 gap-1.5"
              onClick={() => {
                void live.refetch();
                void multi.refetch();
              }}
              disabled={live.isFetching}
              aria-label="Refresh data"
            >
              {live.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
            <Button asChild variant="ghost" size="pill" className="h-8 gap-1">
              <Link to={`/oi-analysis?symbol=${encodeURIComponent(symbol)}${expiry ? `&expiry=${expiry}` : ""}`}>
                OI Analysis <ArrowUpRight />
              </Link>
            </Button>
          </>
        }
      />
      <ExpiryPills expiries={expiries} value={expiry} onChange={selectExpiry} />

      {live.isError && !live.data && (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm text-bearish" role="alert">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Could not load the option chain. Try refresh.
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary-ink" /> Loading {symbol} option chain…
          </CardContent>
        </Card>
      ) : (
        <>
          <MaxPainCurve symbol={symbol} chain={chain} spot={spot} expiry={expiry} lotSize={lotSize} sample={liveSample} />
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <MaxPainTable rows={rows} spot={spot} selected={expiry} onSelect={selectExpiry} loading={multi.isLoading} />
            <PCRSuite rows={rows} selected={expiry} onSelect={selectExpiry} />
          </div>
          <IntradayPCR symbol={symbol} expiry={expiry} spot={spot} />
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <PCRHistory symbol={symbol} currentPcr={current?.pcr.pcrOI ?? 0} sample={liveSample} />
            <MaxPainDrift symbol={symbol} />
          </div>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        {EDU_NOTE} Max pain, expected move and PCR are computed in your browser from the option chain; intraday and daily history exist only for the time this terminal was open.
      </p>
    </div>
  );
}
