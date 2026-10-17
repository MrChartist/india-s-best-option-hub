import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpRight, Minus, Shield, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { strategyBuilderUrl, type BasketLeg } from "@/components/option-chain/basket";
import { contractPath } from "@/lib/history/contractSeries";
import { type OptionData } from "@/lib/mockData";
import { getLatestSnapshots, type ChainSnapshot } from "@/lib/snapshotStore";
import { formatINR, formatTimeIST, getMarketSession } from "@/lib/options";
import { getOILevels, snapshotRowsToChain, wallCreditSpread, wallShift, type OILevel, type WallSpread } from "@/lib/oiUtils";
import { EmptyState, ModuleHeader } from "@/components/oi/shared";
import { fmtOI, fmtOIChange, fmtStrike } from "@/components/oi/format";
import { cn } from "@/lib/utils";

interface SupportResistanceProps {
  chain: OptionData[];
  spotPrice: number;
  /** With symbol and expiry, walls are compared with the previous recorded snapshot. */
  symbol?: string;
  expiry?: string;
  /** Timestamp of the current chain; the previous snapshot must be older than this. */
  asOf?: number;
}

/** Latest recorded snapshot at least 30 s older than `asOf`. */
function usePreviousSnapshot(symbol?: string, expiry?: string, asOf?: number) {
  return useQuery({
    queryKey: ["oi-prev-snapshot", symbol?.toUpperCase(), expiry, Math.floor((asOf ?? 0) / 60_000)],
    queryFn: async (): Promise<ChainSnapshot | null> => {
      const snaps = await getLatestSnapshots(symbol ?? "", expiry ?? "", 4);
      const cutoff = (asOf ?? Date.now()) - 30_000;
      const older = snaps.filter((s) => s.ts <= cutoff);
      return older.length > 0 ? older[older.length - 1] : null;
    },
    enabled: !!symbol && !!expiry,
    refetchInterval: () => (getMarketSession() === "open" ? 60_000 : false),
    staleTime: 30_000,
    retry: 0,
  });
}

function ShiftIcon({ dir, label }: { dir: ReturnType<typeof wallShift>; label: string }) {
  if (dir === "unknown") return null;
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  const text = dir === "same" ? `${label} unchanged since the last snapshot` : `${label} moved ${dir} since the last snapshot`;
  return (
    <span className={cn("inline-flex items-center", dir === "same" ? "text-muted-foreground" : "text-primary-ink")} title={text} aria-label={text}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function LevelRow({ level, prevOI, href }: { level: OILevel; prevOI: number | null; href?: string }) {
  const delta = prevOI === null ? null : level.oi - prevOI;
  const side = level.type === "resistance" ? "CE" : "PE";
  return (
    <div className="flex items-center gap-2 rounded-chip px-1 py-1.5 hover:bg-muted/50">
      {href ? (
        <Link
          to={href}
          className="w-[72px] shrink-0 rounded-chip font-num text-xs font-semibold underline-offset-4 hover:text-primary-ink hover:underline focus-visible:shadow-ember focus-visible:outline-none"
          aria-label={`Open the ${fmtStrike(level.strike)} ${side} contract page`}
        >
          {fmtStrike(level.strike)}
        </Link>
      ) : (
        <span className="w-[72px] shrink-0 font-num text-xs font-semibold">{fmtStrike(level.strike)}</span>
      )}
      <div
        className="h-2 flex-1 overflow-hidden rounded-capsule bg-muted"
        role="meter"
        aria-valuenow={level.strength}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${level.type} strength at ${fmtStrike(level.strike)}`}
      >
        <div className={cn("h-full rounded-capsule", level.type === "resistance" ? "bg-bearish" : "bg-bullish")} style={{ width: `${level.strength}%` }} />
      </div>
      <div className="w-[76px] shrink-0 text-right">
        <p className="font-num text-xs">{fmtOI(level.oi)}</p>
        <p className="font-num text-[11px] text-muted-foreground">
          {level.distancePercent.toFixed(1)}%
          {delta !== null && delta !== 0 && <span className={cn("ml-1", delta > 0 ? "text-foreground" : "text-muted-foreground")}>{fmtOIChange(delta)}</span>}
        </p>
      </div>
    </div>
  );
}

/** The level with the highest score (OI plus weighted fresh OI). */
function strongest(xs: OILevel[]): OILevel | undefined {
  return xs.length ? [...xs].sort((a, b) => b.score - a.score)[0] : undefined;
}

function spreadLegs(spread: WallSpread, symbol: string, expiry: string): BasketLeg[] {
  return [
    { symbol, expiry, strike: spread.sell.strike, type: spread.type, side: "SELL", lots: 1, premium: spread.sell.premium, iv: spread.sell.iv },
    { symbol, expiry, strike: spread.buy.strike, type: spread.type, side: "BUY", lots: 1, premium: spread.buy.premium, iv: spread.buy.iv },
  ];
}

/** "Sell 24,500 CE / buy 24,700 CE in builder": a credit spread written at the wall. */
function WallTrade({ spread, symbol, expiry }: { spread: WallSpread; symbol: string; expiry: string }) {
  const credit = spread.netCredit > 0;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <Button asChild variant="outline" size="pill" className="h-7 gap-1 text-xs">
        <Link
          to={strategyBuilderUrl(spreadLegs(spread, symbol, expiry))}
          title={`${spread.type === "CE" ? "Bear call" : "Bull put"} spread: 1 lot each, priced at mid. Review before trading.`}
        >
          Sell {fmtStrike(spread.sell.strike)} {spread.type} / buy {fmtStrike(spread.buy.strike)} {spread.type} in builder <ArrowUpRight />
        </Link>
      </Button>
      <span className="font-num text-[11px] text-muted-foreground">
        {credit ? `Credit ${formatINR(spread.netCredit, { decimals: 2 })}` : "No credit at mid"} · width {fmtStrike(spread.width)} pts
      </span>
    </div>
  );
}

/**
 * OI walls: resistance from call OI at or above spot, support from put OI at or below spot.
 * Fresh OI added today counts extra. Arrows show how the strongest wall moved since the previous
 * recorded snapshot (when the recorder has one).
 */
export function SupportResistance({ chain, spotPrice, symbol, expiry, asOf }: SupportResistanceProps) {
  const levels = useMemo(() => getOILevels(chain, spotPrice), [chain, spotPrice]);
  const { data: prevSnap } = usePreviousSnapshot(symbol, expiry, asOf);
  const prev = useMemo(() => {
    if (!prevSnap) return null;
    const pc = snapshotRowsToChain(prevSnap);
    const map = new Map<string, number>();
    for (const r of pc) {
      map.set(`CE|${r.strikePrice}`, r.ce.oi);
      map.set(`PE|${r.strikePrice}`, r.pe.oi);
    }
    // Previous strongest walls by plain OI (snapshots carry no day OI change).
    const pl = getOILevels(pc, prevSnap.spot || spotPrice, { freshWeight: 0 });
    const nl = getOILevels(chain, spotPrice, { freshWeight: 0 });
    const top = (xs: OILevel[]) => (xs.length ? [...xs].sort((a, b) => b.score - a.score)[0].strike : NaN);
    return {
      ts: prevSnap.ts,
      oi: map,
      resShift: wallShift(top(pl.resistance), top(nl.resistance)),
      supShift: wallShift(top(pl.support), top(nl.support)),
    };
  }, [prevSnap, chain, spotPrice]);

  const prevOI = (l: OILevel): number | null => {
    if (!prev) return null;
    const v = prev.oi.get(`${l.type === "resistance" ? "CE" : "PE"}|${l.strike}`);
    return v === undefined ? null : v;
  };

  const empty = levels.resistance.length === 0 && levels.support.length === 0;
  const canLink = !!symbol && !!expiry;
  const trades = useMemo(() => {
    if (!symbol || !expiry) return { res: null, sup: null };
    const r = strongest(levels.resistance);
    const s = strongest(levels.support);
    return {
      res: r ? wallCreditSpread(chain, r.strike, "CE", spotPrice) : null,
      sup: s ? wallCreditSpread(chain, s.strike, "PE", spotPrice) : null,
    };
  }, [levels, chain, spotPrice, symbol, expiry]);
  const href = (l: OILevel) => (canLink ? contractPath(symbol as string, expiry as string, l.strike, l.type === "resistance" ? "CE" : "PE") : undefined);

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Target className="h-4 w-4 text-primary-ink" />}
        title="Support and resistance from OI"
        hint={prev ? `Change vs snapshot at ${formatTimeIST(prev.ts)}` : "Fresh OI added today is weighted extra."}
      />
      <CardContent className="space-y-3 p-4">
        {empty ? (
          <EmptyState icon={<Target className="h-5 w-5" />} title="No OI walls yet">
            Support and resistance appear once the chain has open interest around spot.
          </EmptyState>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Badge variant="bearish">
                  <Shield aria-hidden="true" /> Resistance
                </Badge>
                {prev && <ShiftIcon dir={prev.resShift} label="Main resistance" />}
              </div>
              {levels.resistance.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No call wall above spot.</p>
              ) : (
                levels.resistance.map((l) => <LevelRow key={`r${l.strike}`} level={l} prevOI={prevOI(l)} href={href(l)} />)
              )}
              {trades.res && <WallTrade spread={trades.res} symbol={symbol as string} expiry={expiry as string} />}
            </div>

            <div className="rounded-tile border border-primary/30 bg-wash-brand/55 px-2 py-2 text-center">
              <p className="text-label uppercase text-muted-foreground">Spot</p>
              <p className="font-num text-sm font-bold">{spotPrice > 0 ? spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Badge variant="bullish">
                  <Shield aria-hidden="true" /> Support
                </Badge>
                {prev && <ShiftIcon dir={prev.supShift} label="Main support" />}
              </div>
              {levels.support.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">No put wall below spot.</p>
              ) : (
                levels.support.map((l) => <LevelRow key={`s${l.strike}`} level={l} prevOI={prevOI(l)} href={href(l)} />)
              )}
              {trades.sup && <WallTrade spread={trades.sup} symbol={symbol as string} expiry={expiry as string} />}
            </div>
            {(trades.res || trades.sup) && (
              <p className="px-1 text-[11px] text-muted-foreground">Spreads open in the Strategy Builder for review: 1 lot each at mid prices. Positioning, not a recommendation.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
