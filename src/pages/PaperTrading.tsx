/**
 * Paper Trading: a virtual options account on live NSE/BSE chains.
 *
 * Orders fill at mid ± slippage, SL / targets are checked on every quote update, contracts settle at
 * intrinsic at 15:30 IST on expiry (STT on exercise for ITM longs), and every rupee of charges is in
 * the ledger. SEBI-style guardrails sit in front of every new order: a mandatory max loss (₹ and % of
 * capital), beginner mode (no naked shorts), a daily loss cap and a kill switch. State lives in this
 * browser under "mc_paper_v1", saved about a second after the last change and flushed on page hide.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookOpenCheck, Download, FlaskConical, Layers, LineChart, Upload, Wallet, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { ChainFeed } from "@/components/positions/ChainFeed";
import { downloadText, feedKey, signedINR, spotsFromFeeds, useChainFeeds, type FeedSnapshot } from "@/components/positions/helpers";
import { EduNote, Panel, STAT_GROUP, Stat } from "@/components/positions/ui";
import { AccountSheet } from "@/components/paper/AccountSheet";
import { BasketConfirmDialog } from "@/components/paper/BasketConfirmDialog";
import { basketPreview } from "@/components/paper/basketPreview";
import { GuardrailBar } from "@/components/paper/GuardrailBar";
import { OrderBook } from "@/components/paper/OrderBook";
import { OrderTicket, type TicketOrder } from "@/components/paper/OrderTicket";
import { ClosedTrades, PaperPositions } from "@/components/paper/PaperPositions";
import { PaperLedger } from "@/components/paper/PaperLedger";
import { PnLCalendar } from "@/components/paper/PnLCalendar";
import { useEntryContext } from "@/components/paper/useEntryContext";
import { decodeLegs, readBasket, strategyBuilderUrl, type BasketLeg } from "@/components/option-chain/basket";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatCompactIN, formatDateIST, formatINR, formatNumberIN, formatPct, getExpiries, getLotSize, istDateString } from "@/lib/options";
import type { OptionData } from "@/lib/mockData";
import { cn } from "@/lib/utils";
import {
  activateKillSwitch,
  basketToOrders,
  cancelOrder,
  compactLedger,
  paperChangeIsMaterial,
  contractKey,
  createPaperSaver,
  createPaperState,
  dailyCapBreached,
  dailyPnl,
  exportPaperState,
  funds,
  guardCheck,
  guardrailsOf,
  killSwitchActive,
  loadPaper,
  PAPER_KEY,
  marketFillPrice,
  nakedShortViolations,
  parsePaperState,
  placeOrder,
  processTick,
  releaseKillSwitch,
  setPositionRisk,
  squareOff,
  todayPnl,
  type Contract,
  type Guardrails,
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
  const [state, setState] = useState<PaperState>(() => compactLedger(loadPaper() ?? createPaperState(), new Date()));
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Debounced persistence (about 1 s), flushed when the page is hidden or closed ──
  const saveWarned = useRef(false);
  const saver = useMemo(
    () =>
      createPaperSaver({
        delayMs: 1000,
        onError: () => {
          if (saveWarned.current) return;
          saveWarned.current = true;
          toast.error("Could not save the paper account", { description: "Browser storage is full or blocked. Export a JSON copy to keep your trades." });
        },
      }),
    [],
  );
  // State that came from another tab's save is already on disk: do not write it back.
  const fromOtherTab = useRef<PaperState | null>(null);
  // Last state written (or adopted from another tab). Price ticks only change marks, so they are
  // deferred instead of saved: otherwise every tab writes the account about once a second and a
  // tick save from one tab discards an order just placed in another.
  const savedBase = useRef<PaperState | null>(null);
  useEffect(() => {
    if (fromOtherTab.current === state) {
      fromOtherTab.current = null;
      savedBase.current = state;
      return;
    }
    if (paperChangeIsMaterial(savedBase.current, state)) {
      savedBase.current = state;
      saver.schedule(state);
    } else {
      saver.defer(state);
    }
  }, [state, saver]);

  // ── Several tabs on one paper account ──
  // Each tab holds the account in memory and saves the whole thing, so without this the last tab to
  // save would silently wipe orders placed in another. When another tab writes PAPER_KEY, drop any
  // pending save of the older copy and adopt the saved account.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PAPER_KEY) return;
      const hadPending = saver.pending();
      saver.cancel();
      const next = loadPaper();
      if (!next) return;
      const compacted = compactLedger(next, new Date());
      fromOtherTab.current = compacted;
      stateRef.current = compacted;
      setState(compacted);
      if (hadPending) toast.message("Paper account updated in another tab", { id: "paper-other-tab", description: "This tab reloaded the latest saved account. Use one tab for paper trading to avoid losing changes." });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [saver]);

  // Warn once when the paper account is open in another tab as well.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel("mc_paper_tabs");
    } catch {
      return;
    }
    const warn = () => toast.message("Paper Trading is open in another tab", { id: "paper-other-tab", description: "Both tabs share one account and stay in sync, but use one tab to place orders." });
    ch.onmessage = (e: MessageEvent) => {
      if (e.data === "hello") ch.postMessage("here");
      if (e.data === "hello" || e.data === "here") warn();
    };
    ch.postMessage("hello");
    return () => ch.close();
  }, []);
  useEffect(() => {
    const flush = () => saver.flush();
    const onVis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [saver]);

  const [symbol, setSymbolRaw] = useState("NIFTY");
  const [expiry, setExpiry] = useState(() => firstExpiry("NIFTY"));
  const setSymbol = (s: string) => {
    setSymbolRaw(s);
    setExpiry(firstExpiry(s));
  };
  const [staged, setStaged] = useState<BasketLeg[]>([]);
  const [tab, setTab] = useState("positions");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const basketRef = useRef<HTMLDivElement>(null);
  const [basketFlash, setBasketFlash] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [feeds, report] = useChainFeeds();
  const now = useNow(15_000);
  const { contextFor, vix, vixSource } = useEntryContext();

  const focusBasket = useCallback(() => {
    setBasketFlash(true);
    window.setTimeout(() => setBasketFlash(false), 1600);
    requestAnimationFrame(() => {
      basketRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      basketRef.current?.focus({ preventScroll: true });
    });
  }, []);

  // ?legs=<base64url> from the option chain or strategy builder: stage them and jump to the basket.
  useEffect(() => {
    const enc = params.get("legs");
    if (!enc) return;
    const legs = decodeLegs(enc);
    if (legs.length) {
      setStaged(legs);
      focusBasket();
      toast.success(`Loaded ${legs.length} leg${legs.length === 1 ? "" : "s"} from the link`, { description: "Review them in the basket, then place." });
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

  // ── Daily loss cap: trips the kill switch once today's loss reaches the cap ──
  useEffect(() => {
    const s = stateRef.current;
    if (killSwitchActive(s, now) || !dailyCapBreached(s, now)) return;
    const next = activateKillSwitch(s, now, "Daily loss cap reached");
    stateRef.current = next;
    setState(next);
    toast.error("Daily loss cap reached", { description: "The kill switch is on: open orders were cancelled and new orders are blocked until the next session. Exits still work." });
  }, [state.positions, state.trades, now]);

  // ── Actions ──
  const contextForContract = useCallback(
    (c: Contract) => {
      const f = feeds[feedKey(c.symbol, c.expiry)];
      const chain = f?.expiryMatch ? f.chain : [];
      return contextFor({ symbol: c.symbol, expiry: c.expiry, ivPct: legIvPct(chain, c), atmIvPct: atmIvPct(chain, f?.spot ?? NaN), spot: f?.spot ?? null });
    },
    [feeds, contextFor],
  );

  const f = useMemo(() => funds(state, spots, now), [state, spots, now]);
  const capital = f.equity > 0 ? f.equity : state.startingCapital;
  const guardrails = guardrailsOf(state);

  const guardTicket = useCallback(
    (input: TicketOrder, price: number, maxLoss: number | null) => guardCheck(state, [{ input, price }], maxLoss, { now: new Date(), capital }),
    [state, capital],
  );
  const wouldBeNaked = useCallback((input: TicketOrder) => nakedShortViolations(state.positions, [input]).length > 0, [state.positions]);

  const place = (input: TicketOrder, quote: Quote | null, maxLoss: number | null): boolean => {
    const s0 = stateRef.current;
    const liveQuote = quoteFromFeed(feeds[feedKey(input.symbol, input.expiry)], input) ?? quote;
    const px = input.orderType === "LIMIT" ? input.limitPrice ?? NaN : marketFillPrice(liveQuote, input.side, s0.settings.slippagePct);
    const g = guardCheck(s0, [{ input, price: px }], maxLoss, { now: new Date(), capital });
    if (!g.ok) {
      toast.error("Blocked by your guardrails", { description: g.blockers.join(" ") });
      return false;
    }
    const res = placeOrder(s0, { ...input, context: contextForContract(input) }, { quote: liveQuote, now: new Date(), spots });
    stateRef.current = res.state;
    setState(res.state);
    if (res.outcome === "rejected") toast.error("Order rejected", { description: res.message });
    else if (res.outcome === "open") toast(res.message);
    else toast.success(res.message);
    return res.outcome !== "rejected";
  };

  const basketOrders = useMemo(() => basketToOrders(staged, (s, e) => getLotSize(s, e)), [staged]);
  const preview = useMemo(
    () => (confirmOpen && basketOrders.orders.length ? basketPreview(state, basketOrders.orders, (c) => quoteFromFeed(feeds[feedKey(c.symbol, c.expiry)], c), spots, now) : null),
    [confirmOpen, basketOrders, state, feeds, spots, now],
  );
  const guardBasket = useCallback((maxLoss: number | null) => (preview ? guardCheck(state, preview.riskLegs, maxLoss, { now: new Date(), capital }) : null), [preview, state, capital]);

  const placeBasket = (maxLoss: number | null) => {
    const { orders, skipped } = basketOrders;
    let s = stateRef.current;
    const pv = basketPreview(s, orders, (c) => quoteFromFeed(feeds[feedKey(c.symbol, c.expiry)], c), spots, new Date());
    const g = guardCheck(s, pv.riskLegs, maxLoss, { now: new Date(), capital });
    if (!g.ok) {
      toast.error("Blocked by your guardrails", { description: g.blockers.join(" ") });
      return;
    }
    setConfirmOpen(false);
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

  const kill = (alsoSquareOff: boolean) => {
    let s = activateKillSwitch(stateRef.current, new Date());
    let closed = 0;
    if (alsoSquareOff) {
      for (const p of [...s.positions]) {
        const res = squareOff(s, p.key, { quote: quotes[p.key] ?? null, now: new Date(), spots });
        if (res?.outcome === "filled") {
          s = res.state;
          closed++;
        }
      }
    }
    stateRef.current = s;
    setState(s);
    toast.error("Kill switch on", { description: `New orders are blocked until the next session.${alsoSquareOff ? ` ${closed} position${closed === 1 ? "" : "s"} squared off.` : ""}` });
  };
  const release = () => {
    const next = releaseKillSwitch(stateRef.current);
    stateRef.current = next;
    setState(next);
    toast("Kill switch released");
  };

  const updateSettings = (patch: Partial<Omit<PaperState["settings"], "guardrails">>) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const updateGuardrails = (patch: Partial<Guardrails>) => setState((s) => ({ ...s, settings: { ...s.settings, guardrails: { ...guardrailsOf(s), ...patch } } }));

  const reset = (cap: number) => {
    const next = createPaperState(cap, new Date(), stateRef.current.settings);
    stateRef.current = next;
    setState(next);
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
      const next = compactLedger(parsed, new Date());
      stateRef.current = next;
      setState(next);
      toast.success("Paper account imported", { description: `${parsed.positions.length} open positions, ${parsed.trades.length} trades.` });
    };
    reader.readAsText(file);
  };

  const builderHref = useCallback(
    (sym: string) =>
      strategyBuilderUrl(
        state.positions
          .filter((p) => p.symbol === sym)
          .map((p) => ({ symbol: p.symbol, expiry: p.expiry, strike: p.strike, type: p.type, side: p.netLots > 0 ? ("BUY" as const) : ("SELL" as const), lots: Math.abs(p.netLots), premium: p.avgPrice, iv: null })),
      ),
    [state.positions],
  );

  // ── Derived ──
  const daily = useMemo(() => dailyPnl(state), [state]);
  const ret = state.startingCapital > 0 ? ((f.equity - state.startingCapital) / state.startingCapital) * 100 : NaN;
  const ticketFeed = feeds[feedKey(symbol, expiry)];
  const openOrders = state.orders.filter((o) => o.status === "OPEN").length;
  const anySample = state.positions.some((p) => p.markSource === "sample") || ticketFeed?.source === "sample";
  const today = istDateString(now);
  const killOn = killSwitchActive(state, now);
  const symbolsOpen = [...new Set(state.positions.map((p) => p.symbol))];
  const stagedNaked = guardrails.beginnerMode ? nakedShortViolations(state.positions, basketOrders.orders) : [];

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      {pairs.map((x) => (
        <ChainFeed key={feedKey(x.symbol, x.expiry)} symbol={x.symbol} expiry={x.expiry} onUpdate={report} />
      ))}

      <PageHeader
        icon={Wallet}
        title="Paper Trading"
        description="Practise option trades with virtual money on live chains. Real fills at mid plus slippage, real charges, stops and targets, automatic settlement at expiry, and guardrails before every order."
        source={
          <>
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
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/journal?source=paper">
                <BookOpenCheck aria-hidden="true" /> Journal
              </Link>
            </Button>
            <AccountSheet state={state} onSettings={updateSettings} onGuardrails={updateGuardrails} onReset={reset} />
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
          </>
        }
      />

      <div className={cn(STAT_GROUP, "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6")}>
        <Stat label="Equity" value={formatCompactIN(f.equity, { symbol: true, decimals: 2 })} sub={`started ${formatCompactIN(state.startingCapital, { symbol: true })}`} help="Cash plus the marked value of open positions (long value minus short liability)." />
        <Stat label="Return" value={formatPct(ret, { decimals: 2, signed: true })} tone={ret > 0 ? "bullish" : ret < 0 ? "bearish" : "muted"} sub="on starting capital" />
        <Stat label="Available" value={formatCompactIN(f.available, { symbol: true, decimals: 2 })} tone={f.available < 0 ? "bearish" : undefined} sub="cash − margin" help="Cash left after blocking SPAN-style margin for short options. New orders must keep this above zero." />
        <Stat label="Margin blocked" value={formatCompactIN(f.margin, { symbol: true, decimals: 2 })} sub="estimate for shorts" />
        <Stat label="Unrealised" value={signedINR(f.unrealised)} tone={f.unrealised > 0 ? "bullish" : f.unrealised < 0 ? "bearish" : "muted"} sub="before exit charges" />
        <Stat label="Realised" value={signedINR(f.realisedNet)} tone={f.realisedNet > 0 ? "bullish" : f.realisedNet < 0 ? "bearish" : "muted"} sub="net of all charges" />
      </div>

      <GuardrailBar guardrails={guardrails} todayPnl={todayPnl(state, now)} killSwitch={state.killSwitch} killActive={killOn} openPositions={state.positions.length} onKill={kill} onRelease={release} />

      <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <div className="min-w-0">
          <Panel title="Order ticket" subtitle="Pick a price in the mini chain, set your max loss, then buy or sell.">
            <OrderTicket
              symbol={symbol}
              onSymbol={setSymbol}
              expiry={expiry}
              onExpiry={setExpiry}
              feed={ticketFeed}
              slippagePct={state.settings.slippagePct}
              allowSampleFills={state.settings.allowSampleFills}
              brokerId={state.settings.brokerId}
              capital={capital}
              maxRiskPct={guardrails.maxRiskPct}
              beginnerMode={guardrails.beginnerMode}
              guard={guardTicket}
              wouldBeNaked={wouldBeNaked}
              onPlace={place}
            />
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
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
              <Panel
                title="Open positions"
                subtitle="Netted per contract. Edit SL or target in place; they trigger a market exit on the next quote."
                bodyClassName="p-0"
                actions={
                  symbolsOpen.length === 1 ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to={builderHref(symbolsOpen[0])}>
                        <LineChart aria-hidden="true" /> Analyse in builder
                      </Link>
                    </Button>
                  ) : null
                }
              >
                <PaperPositions
                  positions={state.positions}
                  builderHref={builderHref}
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
              <Panel
                title="Closed trades"
                subtitle="Exits, stops, targets and expiry settlements, each tagged with IVP, VIX and DTE at entry."
                bodyClassName="p-0"
                actions={
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/journal?source=paper">
                      <BookOpenCheck aria-hidden="true" /> Edge analytics
                    </Link>
                  </Button>
                }
              >
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

          <div ref={basketRef} id="paper-basket" tabIndex={-1} className={cn("scroll-mt-20 rounded-card outline-none transition-shadow duration-settle", basketFlash && "shadow-focus")}>
            <Panel
              title={
                <>
                  <Layers className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Basket
                  {staged.length ? <Badge variant="neutral">{staged.length}</Badge> : null}
                </>
              }
              subtitle="Legs from the option-chain basket or a Strategy Builder link. Reviewed with margin and charges, then placed as market orders."
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
                <p className="text-body-sm text-muted-foreground">
                  No legs staged. Build a basket on the <Link to="/option-chain" className="text-primary-ink underline underline-offset-4">Option Chain</Link> or send one from the{" "}
                  <Link to="/strategy-builder" className="text-primary-ink underline underline-offset-4">Strategy Builder</Link>.
                </p>
              ) : (
                <div className="space-y-3">
                  <ul className="divide-y divide-separator overflow-hidden rounded-tile border border-separator">
                    {staged.map((l, i) => {
                      const q = quotes[contractKey(l)];
                      const lot = getLotSize(l.symbol, l.expiry);
                      const naked = l.side === "SELL" && stagedNaked.some((n) => n.startsWith(`${l.symbol} ${l.type} (${l.expiry})`));
                      return (
                        <li key={`${contractKey(l)}-${l.side}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-body-sm">
                          <span className="min-w-0">
                            <Badge variant={l.side === "BUY" ? "bullish" : "bearish"}>{l.side}</Badge>{" "}
                            <span className="font-semibold">
                              {l.lots} × {l.symbol} {formatNumberIN(l.strike)} {l.type}
                            </span>
                            {naked ? (
                              <Badge variant="warning" className="ml-1" title="Beginner mode blocks naked short options. Add a long of the same type.">
                                Naked short
                              </Badge>
                            ) : null}
                            <span className="block text-micro text-muted-foreground">
                              {formatDateIST(l.expiry)} · basket {formatNumberIN(l.premium, 2)} · now {q ? formatNumberIN(q.ltp || (q.bid + q.ask) / 2, 2) : "—"}
                              {q?.source === "sample" ? " (sample)" : ""}
                              {!lot ? " · unknown lot size" : ""}
                            </span>
                          </span>
                          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setStaged((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${l.symbol} ${l.strike} ${l.type} from basket`}>
                            <X className="!size-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  {/* macOS button order: secondary actions first, the default action rightmost. */}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => setStaged([])}>
                      Clear
                    </Button>
                    <Button asChild variant="outline">
                      <Link to={strategyBuilderUrl(staged)}>
                        <LineChart aria-hidden="true" /> Analyse
                      </Link>
                    </Button>
                    <Button onClick={() => setConfirmOpen(true)} disabled={killOn && !basketOrders.orders.length}>
                      Place all at market
                    </Button>
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <BasketConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} preview={preview} capital={capital} maxRiskPct={guardrails.maxRiskPct} guard={guardBasket} onConfirm={placeBasket} />

      <EduNote>Paper trades are simulated. Real fills, slippage and margin will differ. IVP marked * is proxied by the India VIX percentile.</EduNote>
    </div>
  );
}
