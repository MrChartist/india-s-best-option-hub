/** Hero-zero screen: far-OTM contracts under ₹10 with the biggest gains and volume, gamma per ₹ and POP. */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ScanSearch, ShoppingBasket, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addLegs, readBasket, writeBasket } from "@/components/option-chain/basket";
import { contractPath } from "@/lib/history/contractSeries";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompactIN, formatINR, formatPct, formatStrike } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import { heroZeroCandidates, heroZeroLeg, openingLtpMap, sortHeroZero, type HeroSort, type HeroZeroRow, signTone } from "./expiryMath";
import { DerivedBadge, EmptyState, HelpTip, Panel, PanelSkeleton, SampleBadge } from "./ExpiryUi";
import type { SessionMode } from "./useExpirySession";

interface Props {
  symbol: string;
  chain: OptionData[];
  spot: number;
  expiry: string;
  r: number;
  q: number;
  lotSize: number;
  snaps: ChainSnapshot[];
  mode: SessionMode;
  /** Instant to price at: now for live data, the last snapshot time otherwise. */
  at: Date;
  loading?: boolean;
}

const SORTS: Array<{ value: HeroSort; label: string }> = [
  { value: "gain", label: "% gain" },
  { value: "volume", label: "Volume" },
  { value: "gamma", label: "Gamma per ₹" },
  { value: "pop", label: "POP" },
];

export function HeroZeroTable({ symbol, chain, spot, expiry, r, q, lotSize, snaps, mode, at, loading }: Props) {
  const [sort, setSort] = useState<HeroSort>("gain");
  const [maxPrice, setMaxPrice] = useState("10");
  const [side, setSide] = useState<"ALL" | "CE" | "PE">("ALL");
  const openLtp = useMemo(() => openingLtpMap(snaps), [snaps]);
  const atMinute = Math.floor(at.getTime() / 60_000);
  const rows = useMemo(
    () => heroZeroCandidates(chain, { spot, expiry, now: new Date(atMinute * 60_000), r, q, maxPrice: Number(maxPrice), openLtp }),
    [chain, spot, expiry, r, q, maxPrice, openLtp, atMinute],
  );
  const shown = useMemo(() => sortHeroZero(side === "ALL" ? rows : rows.filter((x) => x.type === side), sort).slice(0, 15), [rows, sort, side]);

  const addToBasket = useCallback(
    (x: HeroZeroRow) => {
      const leg = heroZeroLeg(symbol, expiry, x);
      writeBasket(addLegs(readBasket(), [leg]));
      toast.success(`Added ${leg.symbol} ${formatStrike(leg.strike)} ${leg.type} to the basket`, {
        description: `Buy 1 lot at ${formatINR(leg.premium)}${lotSize > 0 ? ` · ${formatINR(leg.premium * lotSize, { decimals: 0 })} per lot` : ""}${mode === "sample" ? " · sample price" : ""}. Open the basket from the Option Chain.`,
      });
    },
    [symbol, expiry, lotSize, mode],
  );

  if (loading) return <PanelSkeleton height={300} label="Loading hero-zero table" />;

  return (
    <Panel
      title={
        <>
          <Ticket className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Hero-zero
          <Badge variant="bearish">
            <AlertTriangle aria-hidden="true" /> Lottery, high risk
          </Badge>
          {mode === "sample" ? <SampleBadge /> : <DerivedBadge title="Greeks derived" />}
        </>
      }
      subtitle="Far out-of-the-money options priced under the cap. Most of these expire worthless."
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="hz-side" className="text-label uppercase text-muted-foreground">Side</Label>
            <Select value={side} onValueChange={(v) => setSide(v as "ALL" | "CE" | "PE")}>
              <SelectTrigger id="hz-side" className="h-8 w-[92px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="CE">Calls</SelectItem>
                <SelectItem value="PE">Puts</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="hz-cap" className="text-label uppercase text-muted-foreground">Price under</Label>
            <Select value={maxPrice} onValueChange={setMaxPrice}>
              <SelectTrigger id="hz-cap" className="h-8 w-[84px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5">₹5</SelectItem>
                <SelectItem value="10">₹10</SelectItem>
                <SelectItem value="20">₹20</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="hz-sort" className="text-label uppercase text-muted-foreground">Sort by</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as HeroSort)}>
              <SelectTrigger id="hz-sort" className="h-8 w-[128px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      }
    >
      <div role="note" className="mb-3 flex items-start gap-2 rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Treat these like lottery tickets. A ₹3 option can go to ₹30 on a sharp move, but far more often it goes to zero by 15:30. Size only what you can lose in full. POP is the model chance of finishing beyond strike plus premium.
        </p>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={<Ticket className="h-6 w-6" aria-hidden="true" />} title="No contracts match">
          {chain.length === 0 ? "No option chain is loaded yet." : "Nothing out of the money is priced under the cap, or this expiry has already settled."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Contract</TableHead>
                <TableHead scope="col" className="text-right">LTP</TableHead>
                <TableHead scope="col" className="text-right">Change</TableHead>
                <TableHead scope="col" className="text-right">Volume</TableHead>
                <TableHead scope="col" className="hidden text-right md:table-cell">OI</TableHead>
                <TableHead scope="col" className="text-right">From spot</TableHead>
                <TableHead scope="col" className="text-right">
                  <span className="inline-flex items-center gap-1">Γ per ₹ <HelpTip text="Gamma divided by premium: how much delta each rupee of premium buys per point of spot move, ×1,000. Higher means more convexity for the money." label="About gamma per rupee" /></span>
                </TableHead>
                <TableHead scope="col" className="hidden text-right sm:table-cell">P(ITM)</TableHead>
                <TableHead scope="col" className="text-right">POP</TableHead>
                <TableHead scope="col" className="hidden text-right lg:table-cell">Cost / lot</TableHead>
                <TableHead scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((x) => (
                <TableRow key={`${x.strike}-${x.type}`}>
                  <TableCell className="whitespace-nowrap font-num tabular-nums">
                    <Link
                      to={contractPath(symbol, expiry, x.strike, x.type)}
                      className="inline-flex items-center gap-1 rounded-chip underline-offset-2 hover:underline focus-visible:shadow-ember focus-visible:outline-none"
                      aria-label={`Open the ${symbol} ${formatStrike(x.strike)} ${x.type} contract page`}
                    >
                      {formatStrike(x.strike)} <Badge variant={x.type === "CE" ? "bearish" : "bullish"} className="ml-1">{x.type}</Badge>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-num tabular-nums">{formatINR(x.ltp)}</TableCell>
                  <TableCell className={cn("text-right font-num tabular-nums", signTone(x.changePct))} title={x.changeBasis === "prev-close" ? "vs previous close" : x.changeBasis === "session-open" ? "vs first snapshot of the session" : "No reference price"}>
                    {Number.isFinite(x.changePct) ? formatPct(x.changePct, { decimals: 0, signed: true }) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-num tabular-nums">{formatCompactIN(x.volume, { decimals: 1 })}</TableCell>
                  <TableCell className="hidden text-right font-num tabular-nums md:table-cell">{formatCompactIN(x.oi, { decimals: 1 })}</TableCell>
                  <TableCell className="text-right font-num tabular-nums">{formatPct(x.distancePct, { decimals: 2 })}</TableCell>
                  <TableCell className="text-right font-num tabular-nums">{Number.isFinite(x.gammaPerRupee) ? (x.gammaPerRupee * 1000).toFixed(3) : "—"}</TableCell>
                  <TableCell className="hidden text-right font-num tabular-nums sm:table-cell">{Number.isFinite(x.probITM) ? formatPct(x.probITM * 100, { decimals: 1 }) : "—"}</TableCell>
                  <TableCell className="text-right font-num tabular-nums">{Number.isFinite(x.pop) ? formatPct(x.pop * 100, { decimals: 1 }) : "—"}</TableCell>
                  <TableCell className="hidden text-right font-num tabular-nums lg:table-cell">{lotSize > 0 ? formatINR(x.ltp * lotSize, { decimals: 0 }) : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => addToBasket(x)} aria-label={`Add ${formatStrike(x.strike)} ${x.type} to basket`} title="Add to basket (buy 1 lot)">
                        <ShoppingBasket aria-hidden="true" />
                      </Button>
                      <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                        <Link to={contractPath(symbol, expiry, x.strike, x.type)} aria-label={`${formatStrike(x.strike)} ${x.type} contract details`} title="Contract details">
                          <ScanSearch aria-hidden="true" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-body-sm text-muted-foreground">
            Change is vs the previous close when the feed sends it, otherwise vs the first snapshot of this session. Greeks and probabilities use Black-76 with each leg&apos;s IV, filled in the browser where NSE sends zero.
          </p>
        </div>
      )}
    </Panel>
  );
}
