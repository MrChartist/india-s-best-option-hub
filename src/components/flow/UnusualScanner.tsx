import { useMemo, useState } from "react";
import { Flame, Plus, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTRACT_SPECS, formatDateIST, formatNumberIN, formatStrike } from "@/lib/options";
import {
  DEFAULT_UNUSUAL_THRESHOLDS,
  UNUSUAL_PRESETS,
  applyPreset,
  isIndexUnderlying,
  unusual,
  type FeedEntry,
  type UnusualFlag,
  type UnusualPresetId,
  type UnusualThresholds,
} from "@/lib/flow";
import { cn } from "@/lib/utils";
import { EmptyState, HelpTip, ModeBadge, Panel } from "./FlowUi";
import { fmtRs, signClass } from "./format";
import { useUnusualHistory } from "./useFlow";

const FLAG_LABEL: Record<UnusualFlag, { text: string; title: string }> = {
  VOL_OI: { text: "Vol > OI", title: "Volume / OI at or above the threshold" },
  VOL_SPIKE: { text: "Vol spike", title: "Volume at or above the multiple of its 5-day average at this time of day" },
  BIG_PREMIUM: { text: "Big premium", title: "Premium traded above the threshold" },
};

interface UnusualScannerProps {
  feeds: Record<string, FeedEntry>;
  /** Called when the user wants to scan another underlying (the page starts polling it). */
  onAddSymbol?: (symbol: string) => void;
  extraSymbols?: string[];
}

function ThresholdEditor({ value, onChange }: { value: UnusualThresholds; onChange: (t: UnusualThresholds) => void }) {
  const field = (k: keyof UnusualThresholds, label: string, step: number, help: string) => (
    <div className="space-y-1">
      <Label htmlFor={`thr-${k}`} className="text-body-sm">
        {label}
      </Label>
      <Input
        id={`thr-${k}`}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value[k]}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange({ ...value, [k]: n });
        }}
        className="h-8 tabular-nums"
        aria-describedby={`thr-${k}-help`}
      />
      <p id={`thr-${k}-help`} className="text-micro normal-case tracking-normal text-muted-foreground">
        {help}
      </p>
    </div>
  );
  return (
    <div className="grid gap-3">
      {field("volOi", "Volume / OI at least", 0.05, "Default 1.25")}
      {field("volMultiple", "Volume × 5-day average at least", 0.5, "Default 3")}
      {field("minPremiumIndex", "Premium, index options (₹)", 100000, "Default ₹10 lakh")}
      {field("minPremiumStock", "Premium, stock options (₹)", 50000, "Default ₹2 lakh")}
      {field("minVolume", "Ignore below (contracts)", 10, "Default 50")}
      <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_UNUSUAL_THRESHOLDS)}>
        Reset to defaults
      </Button>
    </div>
  );
}

const STOCK_CHOICES = Object.values(CONTRACT_SPECS)
  .map((s) => s.symbol)
  .sort();

/** Unusual options activity for one underlying, with presets and editable thresholds. */
export function UnusualScanner({ feeds, onAddSymbol, extraSymbols = [] }: UnusualScannerProps) {
  const symbols = Object.keys(feeds);
  const [picked, setPicked] = useState<string>("");
  const symbol = picked && feeds[picked] ? picked : (symbols[0] ?? "");
  const feed = symbol ? feeds[symbol] : undefined;
  const [preset, setPreset] = useState<UnusualPresetId>("all");
  const [thresholds, setThresholds] = useState<UnusualThresholds>(DEFAULT_UNUSUAL_THRESHOLDS);
  const isSample = feed?.mode === "sample";
  const history = useUnusualHistory(symbol, feed?.expiry ?? "", !!feed && !isSample);
  const hist = history.data;

  const all = useMemo(
    () =>
      feed
        ? unusual(
            {
              symbol: feed.symbol,
              expiry: feed.expiry,
              spot: feed.spot,
              lotSize: feed.lotSize,
              chain: feed.chain,
              ts: feed.asOf,
            },
            hist,
            thresholds,
          )
        : [],
    [feed, hist, thresholds],
  );
  const list = useMemo(() => applyPreset(all, preset), [all, preset]);
  const counts = useMemo(
    () => Object.fromEntries(UNUSUAL_PRESETS.map((p) => [p.id, applyPreset(all, p.id).length])),
    [all],
  );

  const histNote = isSample
    ? "Volume-spike check is off for sample data."
    : history.isLoading
      ? "Reading recorded history…"
      : hist && hist.days > 0
        ? `5-day average from ${hist.days} recorded session${hist.days === 1 ? "" : "s"} at this time of day.`
        : "Volume-spike check needs recorded snapshots from earlier sessions (keep the app open during market hours to build them).";

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          <Flame className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Unusual activity
        </span>
      }
      subtitle={`Vol/OI ≥ ${thresholds.volOi}, volume ≥ ${thresholds.volMultiple}× 5-day average, premium ≥ ${fmtRs(feed && isIndexUnderlying(feed.symbol) ? thresholds.minPremiumIndex : thresholds.minPremiumStock)}`}
      actions={
        <>
          {feed ? <ModeBadge mode={feed.mode} asOf={feed.asOf} reason={feed.reason} /> : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="pill">
                <SlidersHorizontal aria-hidden="true" /> Thresholds
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72">
              <ThresholdEditor value={thresholds} onChange={setThresholds} />
            </PopoverContent>
          </Popover>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Underlying" className="flex flex-wrap gap-1">
            {symbols.map((s) => (
              <Button
                key={s}
                role="tab"
                aria-selected={s === symbol}
                variant={s === symbol ? "default" : "outline"}
                size="pill"
                onClick={() => setPicked(s)}
              >
                {s}
              </Button>
            ))}
          </div>
          {onAddSymbol ? (
            <Select
              value=""
              onValueChange={(v) => {
                if (!v) return;
                onAddSymbol(v);
                setPicked(v);
              }}
            >
              <SelectTrigger className="h-7 w-[170px] rounded-pill text-body-sm" aria-label="Scan another underlying">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <SelectValue placeholder="Add underlying" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {STOCK_CHOICES.filter((s) => !symbols.includes(s) && !extraSymbols.includes(s)).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4"
          role="radiogroup"
          aria-label="Scanner preset"
        >
          {UNUSUAL_PRESETS.map((p) => {
            const on = p.id === preset;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPreset(p.id)}
                className={cn(
                  "rounded-tile border p-3 text-left transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                  on ? "border-primary/60 bg-wash-brand/60" : "border-border bg-card hover:bg-muted/50",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{p.label}</span>
                  <Badge variant={on ? "default" : "neutral"}>{counts[p.id] ?? 0}</Badge>
                </span>
                <span className="mt-1 block text-body-sm text-muted-foreground">{p.description}</span>
                {p.id !== "all" ? (
                  <span className="mt-1.5 block text-micro uppercase text-muted-foreground">
                    Educational, not advice
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
          <HelpTip text="Volume and OI are cumulative for the day, in contracts. Price change uses the feed's change vs previous close when available; presets that need it ignore that condition when it is missing." />
          {histNote}
        </p>

        {!feed ? (
          <EmptyState title="Loading chains">Waiting for the first option-chain poll.</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState title="Nothing unusual right now">
            No {symbol} contract for {formatDateIST(feed.expiry)} trips the{" "}
            {preset === "all" ? "" : `"${UNUSUAL_PRESETS.find((p) => p.id === preset)?.label}" `}thresholds. Try another
            preset or loosen the thresholds.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-tile border border-border">
            <table className="w-full min-w-[820px] text-body-sm">
              <caption className="sr-only">
                Unusual {symbol} options for {formatDateIST(feed.expiry)}
              </caption>
              <thead className="bg-surface text-left text-label uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Contract
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Signals
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Volume
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    OI
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Vol/OI
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    × avg
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Premium
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    LTP
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    OI chg
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.slice(0, 60).map((c) => (
                  <tr key={c.key} className="hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="font-semibold tabular-nums">{formatStrike(c.strike)}</span>{" "}
                      <span className={c.type === "CE" ? "text-bullish" : "text-bearish"}>{c.type}</span>
                      <span className="ml-1.5 text-micro uppercase text-muted-foreground">{c.moneyness}</span>
                      <span className="ml-1.5 text-muted-foreground">{c.dte === 0 ? "0DTE" : `${c.dte}d`}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex flex-wrap gap-1">
                        {c.flags.map((f) => (
                          <Badge
                            key={f}
                            variant={f === "BIG_PREMIUM" ? "default" : f === "VOL_SPIKE" ? "warning" : "info"}
                            title={FLAG_LABEL[f].title}
                          >
                            {FLAG_LABEL[f].text}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumberIN(c.volume)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumberIN(c.oi)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {Number.isFinite(c.volOi) ? c.volOi.toFixed(2) : "New"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {c.volMultiple !== undefined ? `${c.volMultiple.toFixed(1)}×` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtRs(c.premium)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatNumberIN(c.ltp, 2)}
                      {c.priceChange !== undefined ? (
                        <span className={cn("ml-1", signClass(c.priceChange))}>
                          {c.priceChange > 0 ? "▲" : c.priceChange < 0 ? "▼" : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", signClass(c.oiChange))}>
                      {c.oiChange > 0 ? "+" : ""}
                      {formatNumberIN(c.oiChange)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 60 ? (
          <p className="text-body-sm text-muted-foreground">Showing the top 60 of {list.length} by score.</p>
        ) : null}
      </div>
    </Panel>
  );
}
