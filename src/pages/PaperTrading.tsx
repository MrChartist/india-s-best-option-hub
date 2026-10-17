/**
 * Paper Trading: a virtual options account on live NSE/BSE chains.
 *
 * Orders fill at mid ± slippage, SL / targets are checked on every quote update, contracts settle at
 * intrinsic at 15:30 IST on expiry (STT on exercise for ITM longs), and every rupee of charges is in
 * the ledger. State lives in this browser under "mc_paper_v1".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Download, FlaskConical, Layers, RotateCcw, Upload, Wallet, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChainFeed } from "@/components/positions/ChainFeed";
import { downloadText, feedKey, signedINR, spotsFromFeeds, useChainFeeds, type FeedSnapshot } from "@/components/positions/helpers";
import { EduNote, Panel, Stat } from "@/components/positions/ui";
import { OrderBook } from "@/components/paper/OrderBook";
import { OrderTicket } from "@/components/paper/OrderTicket";
import { ClosedTrades, PaperPositions } from "@/components/paper/PaperPositions";
import { PaperLedger } from "@/components/paper/PaperLedger";
import { PnLCalendar } from "@/components/paper/PnLCalendar";
import { useEntryContext } from "@/components/paper/useEntryContext";
import { decodeLegs, readBasket, type BasketLeg } from "@/components/option-chain/basket";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { BROKER_PRESETS, formatCompactIN, formatDateIST, formatINR, formatNumberIN, formatPct, getExpiries, getLotSize, istDateString } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import {
  DEFAULT_CAPITAL,
  basketToOrders,
  cancelOrder,
  contractKey,
  createPaperState,
  dailyPnl,
  exportPaperState,
  funds,
  loadPaper,
  parsePaperState,
  placeOrder,
  processTick,
  savePaper,
  setPositionRisk,
  squareOff,
  type Contract,
  type OrderInput,
  type PaperState,
  type Quote,
} from "@/lib/paperTrading";

function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const firstExpiry = (symbol: string) => getExpiries(symbol, new Date(), 1)[0]?.date ?? "";

/** Quote for a contract from its feed; non-live real feeds are marked "cache" so they read as delayed. */
function quoteFromFeed(f: FeedSnapshot | undefined, c: Contract): Quote | null {
  if (!f || f.loading || !f.expiryMatch) return null;
  const row = f.chain.find((r) => r.strikePrice === c.strike);
  const leg = row ? (c.type === "CE" ? row.ce : row.pe) : undefined;
  if (!leg || !(leg.ltp > 0 || (leg.bidPrice > 0 && leg.askPrice > 0))) return null;
  const source = f.source === "sample" ? "sample" : f.isLive ? f.source : "cache";
  return { bid: leg.bidPrice || 0, ask: leg.askPrice || 0, ltp: leg.ltp || 0, source };
}

/** Quotes keyed by contractKey for every open position, open order and staged basket leg. */
function buildQuotes(feeds: Record<string, FeedSnapshot>, state: PaperState, staged: Contract[]): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  const add = (c: Contract) => {
    const q = quoteFromFeed(feeds[feedKey(c.symbol, c.expiry)], c);
    if (q) out[contractKey(c)] = q;
  };
  state.positions.forEach(add);
  state.orders.filter((o) => o.status === "OPEN").forEach(add);
  staged.forEach(add);
  return out;
}

function legIvPct(chain: OptionData[], c: Contract): number | null {
  const row = chain.find((r) => r.strikePrice === c.strike);
  const iv = row ? (c.type === "CE" ? row.ce.iv : row.pe.iv) : 0;
  return iv > 0 ? iv : null;
}

function atmIvPct(chain: OptionData[], spot: number): number | null {
  if (!chain.length || !(spot > 0)) return null;
  const row = chain.reduce((b, r) => (Math.abs(r.strikePrice - spot) < Math.abs(b.strikePrice - spot) ? r : b), chain[0]);
  const ivs = [row.ce.iv, row.pe.iv].filter((v) => v > 0);
  return ivs.length ? ivs.reduce((a, v) => a + v, 0) / ivs.length : null;
}

export default function PaperTrading() {
  useDocumentTitle("Paper Trading");
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<PaperState>(() => loadPaper() ?? createPaperState());
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const saveWarned = useRef(false);
  useEffect(() => {
    if (!savePaper(state) && !saveWarned.current) {
      saveWarned.current = true;
      toast.error("Could not save the paper account", { description: "Browser storage is full or blocked. Export a JSON copy to keep your trades." });
    }
  }, [state]);

  const [symbol, setSymbolRaw] = useState("NIFTY");
  const [expiry, setExpiry] = useState(() => firstExpiry("NIFTY"));
  const setSymbol = (s: string) => {
    setSymbolRaw(s);
    setExpiry(firstExpiry(s));
  };
  const [staged, setStaged] = useState<BasketLeg[]>([]);
  const [tab, setTab] = useState("positions");
  const [capitalText, setCapitalText] = useState(String(state.startingCapital));
  const fileRef = useRef<HTMLInputElement>(null);
  const [feeds, report] = useChainFeeds();
  const now = useNow(15_000);
  const { contextFor, vix, vixSource } = useEntryContext();

  // ?legs=<base64url> from the option chain or strategy builder.
  useEffect(() => {
    const enc = params.get("legs");
    if (!enc) return;
    const legs = decodeLegs(enc);
    if (legs.length) {
      setStaged(legs);
      toast.success(`Loaded ${legs.length} leg${legs.length === 1 ? "" : "s"} from the link`, { description: "Review them under Basket, then place." });
    }
    const next = new URLSearchParams(params);
    next.delete("legs");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the link once on arrival
  }, []);

  // ── Feeds ──
  const pairs = useMemo(() => {
    const m = new Map<string, { symbol: string; expiry: string }>();
    const add = (s: string, e: string) => e && m.set(feedKey(s, e), { symbol: s, expiry: e });
    add(symbol, expiry);
    for (const p of state.positions) add(p.symbol, p.expiry);
    for (const o of state.orders) if (o.status === "OPEN") add(o.symbol, o.expiry);
    for (const l of staged) add(l.symbol, l.expiry);
    return [...m.values()];
  }, [symbol, expiry, state.positions, state.orders, staged]);

  const spotInfo = useMemo(() => spotsFromFeeds(feeds), [feeds]);
  const spots = useMemo(() => Object.fromEntries(Object.entries(spotInfo).map(([s, v]) => [s, v.spot])), [spotInfo]);

  const quotes = useMemo(() => buildQuotes(feeds, state, staged), [feeds, state, staged]);

  // ── Tick: marks, limit fills, SL/target, expiry settlement ──
  useEffect(() => {
    const s = stateRef.current;
    if (!s.positions.length && !s.orders.some((o) => o.status === "OPEN")) return;
    const res = processTick(s, buildQuotes(feeds, s, []), now, spots);
    stateRef.current = res.state;
    setState(res.state);
    for (const e of res.events) {
      if (e.kind === "sl" || e.kind === "rejected") toast.error(e.message);
      else toast.success(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on new feed data and on the clock, never on our own state writes
  }, [feeds, now]);

  // ── Actions ──
  const contextForContract = useCallback(
    (c: Contract) => {
      const f = feeds[feedKey(c.symbol, c.expiry)];
      const chain = f?.expiryMatch ? f.chain : [];
      return contextFor({ symbol: c.symbol, expiry: c.expiry, ivPct: legIvPct(chain, c), atmIvPct: atmIvPct(chain, f?.spot ?? NaN), spot: f?.spot ?? null });
    },
    [feeds, contextFor],
  );

  const place = (input: Omit<OrderInput, "context">, quote: Quote | null): boolean => {
    const liveQuote = quoteFromFeed(feeds[feedKey(input.symbol, input.expiry)], input) ?? quote;
    const res = placeOrder(stateRef.current, { ...input, context: contextForContract(input) }, { quote: liveQuote, now: new Date(), spots });
    stateRef.current = res.state;
    setState(res.state);
    if (res.outcome === "rejected") toast.error("Order rejected", { description: res.message });
    else if (res.outcome === "open") toast(res.message);
    else toast.success(res.message);
    return res.outcome !== "rejected";
  };

  const placeBasket = () => {
    const { orders, skipped } = basketToOrders(staged, (s, e) => getLotSize(s, e));
    let s = stateRef.current;
    let filled = 0;
    const problems: string[] = [];
    const failed = new Set(skipped);
    for (const o of orders) {
      const q = quoteFromFeed(feeds[feedKey(o.symbol, o.expiry)], o);
      const res = placeOrder(s, { ...o, context: contextForContract(o) }, { quote: q, now: new Date(), spots });
      s = res.state;
      if (res.outcome === "filled") filled++;
      else {
        problems.push(`${o.symbol} ${o.strike} ${o.type}: ${res.message}`);
        failed.add(`${o.symbol} ${o.strike} ${o.type}`);
      }
    }
    stateRef.current = s;
    setState(s);
    if (filled) toast.success(`Placed ${filled} of ${staged.length} basket legs at market`);
    if (problems.length || skipped.length) toast.error(`${problems.length + skipped.length} leg${problems.length + skipped.length === 1 ? "" : "s"} not placed`, { description: [...problems, ...skipped.map((x) => `${x}: unknown lot size`)].slice(0, 4).join(" · ") });
    setStaged((cur) => cur.filter((l) => failed.has(`${l.symbol} ${l.strike} ${l.type}`)));
  };

  const exit = (key: string) => {
    const s = stateRef.current;
    const res = squareOff(s, key, { quote: quotes[key] ?? null, now: new Date(), spots });
    if (!res) return;
    stateRef.current = res.state;
    setState(res.state);
    if (res.outcome === "filled") toast.success(res.message);
    else toast.error("Exit failed", { description: res.message });
  };

  const updateSettings = (patch: Partial<PaperState["settings"]>) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

  const reset = () => {
    const cap = Number(capitalText);
    const next = createPaperState(cap > 0 ? cap : DEFAULT_CAPITAL, new Date(), state.settings);
    stateRef.current = next;
    setState(next);
    setCapitalText(String(next.startingCapital));
    toast.success(`Account reset with ${formatINR(next.startingCapital, { decimals: 0 })}`);
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parsePaperState(String(reader.result ?? ""));
      if (!parsed) {
        toast.error("Import failed", { description: "This is not a paper-trading export (version 1)." });
        return;
      }
      stateRef.current = parsed;
      setState(parsed);
      setCapitalText(String(parsed.startingCapital));
      toast.success("Paper account imported", { description: `${parsed.positions.length} open positions, ${parsed.trades.length} trades.` });
    };
    reader.readAsText(file);
  };

  // ── Derived ──
  const f = useMemo(() => funds(state, spots, now), [state, spots, now]);
  const daily = useMemo(() => dailyPnl(state), [state]);
  const ret = state.startingCapital > 0 ? ((f.equity - state.startingCapital) / state.startingCapital) * 100 : NaN;
  const ticketFeed = feeds[feedKey(symbol, expiry)];
  const openOrders = state.orders.filter((o) => o.status === "OPEN").length;
  const anySample = state.positions.some((p) => p.markSource === "sample") || ticketFeed?.source === "sample";
  const today = istDateString(now);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      {pairs.map((x) => (
        <ChainFeed key={feedKey(x.symbol, x.expiry)} symbol={x.symbol} expiry={x.expiry} onUpdate={report} />
      ))}

      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-display">
            <Wallet className="h-6 w-6 text-primary-ink" aria-hidden="true" />
            Paper Trading
          </h1>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            Practise option trades with virtual money on live chains. Real fills at mid plus slippage, real charges, stops and targets, and automatic settlement at expiry.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vix !== null ? (
            <Badge variant={vixSource === "live" ? "info" : "neutral"} title={vixSource === "live" ? "Live India VIX" : "Last close from VIX history"}>
              VIX {vix.toFixed(2)}
            </Badge>
          ) : null}
          {anySample ? (
            <Badge variant="warning">
              <FlaskConical aria-hidden="true" /> Sample quotes in use
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => !downloadText(`paper-account-${today}.json`, exportPaperState(state)) && toast.error("Download failed")}>
            <Download aria-hidden="true" /> Export
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Upload aria-hidden="true" /> Import
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace this paper account?</AlertDialogTitle>
                <AlertDialogDescription>Importing a JSON export replaces the current account, its positions, orders and ledger. Export first if you want to keep it.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => fileRef.current?.click()}>Choose file</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import paper account JSON"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Equity" value={formatCompactIN(f.equity, { symbol: true, decimals: 2 })} sub={`started ${formatCompactIN(state.startingCapital, { symbol: true })}`} help="Cash plus the marked value of open positions (long value minus short liability)." />
        <Stat label="Return" value={formatPct(ret, { decimals: 2, signed: true })} tone={ret > 0 ? "bullish" : ret < 0 ? "bearish" : "muted"} sub="on starting capital" />
        <Stat label="Available" value={formatCompactIN(f.available, { symbol: true, decimals: 2 })} tone={f.available < 0 ? "bearish" : undefined} sub="cash − margin" help="Cash left after blocking SPAN-style margin for short options. New orders must keep this above zero." />
        <Stat label="Margin blocked" value={formatCompactIN(f.margin, { symbol: true, decimals: 2 })} sub="estimate for shorts" />
        <Stat label="Unrealised" value={signedINR(f.unrealised)} tone={f.unrealised > 0 ? "bullish" : f.unrealised < 0 ? "bearish" : "muted"} sub="before exit charges" />
        <Stat label="Realised" value={signedINR(f.realisedNet)} tone={f.realisedNet > 0 ? "bullish" : f.realisedNet < 0 ? "bearish" : "muted"} sub="net of all charges" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Order ticket" subtitle="Pick a price in the mini chain, then buy or sell.">
            <OrderTicket symbol={symbol} onSymbol={setSymbol} expiry={expiry} onExpiry={setExpiry} feed={ticketFeed} slippagePct={state.settings.slippagePct} allowSampleFills={state.settings.allowSampleFills} onPlace={place} />
          </Panel>

          <Panel
            title={
              <>
                <Layers className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Basket
              </>
            }
            subtitle="Legs from the option chain basket or a ?legs= link. Placed as market orders."
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const legs = readBasket();
                  if (!legs.length) toast("The option-chain basket is empty", { description: "Add legs on the Option Chain page first." });
                  else {
                    setStaged(legs);
                    toast.success(`Loaded ${legs.length} leg${legs.length === 1 ? "" : "s"} from the basket`);
                  }
                }}
              >
                Load basket
              </Button>
            }
          >
            {staged.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">No legs staged. Build a basket on the Option Chain page, then load it here.</p>
            ) : (
              <div className="space-y-3">
                <ul className="divide-y divide-border rounded-tile border border-border">
                  {staged.map((l, i) => {
                    const q = quotes[contractKey(l)];
                    const lot = getLotSize(l.symbol, l.expiry);
                    return (
                      <li key={`${contractKey(l)}-${l.side}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-body-sm">
                        <span className="min-w-0">
                          <Badge variant={l.side === "BUY" ? "bullish" : "bearish"}>{l.side}</Badge>{" "}
                          <span className="font-semibold">
                            {l.lots} × {l.symbol} {formatNumberIN(l.strike)} {l.type}
                          </span>
                          <span className="block text-micro text-muted-foreground">
                            {formatDateIST(l.expiry)} · basket {formatNumberIN(l.premium, 2)} · now {q ? formatNumberIN(q.ltp || (q.bid + q.ask) / 2, 2) : "—"}
                            {!lot ? " · unknown lot size" : ""}
                          </span>
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setStaged((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${l.symbol} ${l.strike} ${l.type} from basket`}>
                          <X className="!size-3.5" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={placeBasket}>
                    Place all at market
                  </Button>
                  <Button variant="outline" onClick={() => setStaged([])}>
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Account settings" subtitle="Slippage and broker apply to new fills.">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="paper-slip">Slippage (% of mid)</Label>
                  <Input
                    id="paper-slip"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10}
                    step="0.1"
                    value={state.settings.slippagePct}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0 && v <= 10) updateSettings({ slippagePct: v });
                    }}
                    className="h-9"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="paper-broker">Broker charges</Label>
                  <Select value={state.settings.brokerId} onValueChange={(v) => updateSettings({ brokerId: v })}>
                    <SelectTrigger id="paper-broker" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BROKER_PRESETS.filter((b) => b.id !== "custom").map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} · ₹{b.perOrder}/order
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3">
                <Label htmlFor="paper-sample" className="text-body-sm font-normal leading-snug">
                  Allow fills on sample quotes when no live chain is reachable (fills are labelled “Sample”).
                </Label>
                <Switch id="paper-sample" checked={state.settings.allowSampleFills} onCheckedChange={(v) => updateSettings({ allowSampleFills: v })} />
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor="paper-capital">Virtual capital (₹)</Label>
                  <Input id="paper-capital" type="number" inputMode="numeric" min={10000} step={10000} value={capitalText} onChange={(e) => setCapitalText(e.target.value)} className="h-9" />
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline">
                      <RotateCcw aria-hidden="true" /> Reset account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset the paper account?</AlertDialogTitle>
                      <AlertDialogDescription>
                        All positions, orders, trades and the ledger are deleted and the account restarts with {formatINR(Number(capitalText) > 0 ? Number(capitalText) : DEFAULT_CAPITAL, { decimals: 0 })}.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </Panel>
        </div>

        <div className="min-w-0">
          <Tabs value={tab} onValueChange={setTab} className="space-y-3">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="positions">Positions ({state.positions.length})</TabsTrigger>
                <TabsTrigger value="orders">Orders{openOrders ? ` (${openOrders})` : ""}</TabsTrigger>
                <TabsTrigger value="closed">Closed trades</TabsTrigger>
                <TabsTrigger value="calendar">P&L calendar</TabsTrigger>
                <TabsTrigger value="ledger">Ledger</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="positions" className="mt-0">
              <Panel title="Open positions" subtitle="Netted per contract. Edit SL or target in place; they trigger a market exit on the next quote." bodyClassName="p-0">
                <PaperPositions
                  positions={state.positions}
                  onExit={exit}
                  onRisk={(key, risk) => {
                    setState((s) => setPositionRisk(s, key, risk));
                    toast("Risk levels updated");
                  }}
                />
              </Panel>
            </TabsContent>
            <TabsContent value="orders" className="mt-0">
              <Panel title="Order book" bodyClassName="p-0">
                <OrderBook orders={state.orders} onCancel={(id) => setState((s) => cancelOrder(s, id))} />
              </Panel>
            </TabsContent>
            <TabsContent value="closed" className="mt-0">
              <Panel title="Closed trades" subtitle="Exits, stops, targets and expiry settlements, each tagged with IVP, VIX and DTE at entry." bodyClassName="p-0">
                <ClosedTrades trades={state.trades} />
              </Panel>
            </TabsContent>
            <TabsContent value="calendar" className="mt-0">
              <Panel title="Daily P&L">
                <PnLCalendar daily={daily} />
              </Panel>
            </TabsContent>
            <TabsContent value="ledger" className="mt-0">
              <Panel title="Ledger" subtitle="Every cash movement, net of charges." bodyClassName="p-0">
                <PaperLedger ledger={state.ledger} />
              </Panel>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <EduNote>Paper trades are simulated. Real fills, slippage and margin will differ. IVP marked * is proxied by the India VIX percentile.</EduNote>
    </div>
  );
}
