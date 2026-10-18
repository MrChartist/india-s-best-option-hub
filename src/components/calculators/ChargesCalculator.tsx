import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BROKER_PRESETS,
  calcCharges,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  formatPoints,
  getChargeRates,
  getContractSpec,
  getLotSize,
  istDateString,
  type ChargesBreakdown,
  type Exchange,
  type Side,
} from "@/lib/options";
import { cn } from "@/lib/utils";
import { analyseTrade, isPos, resolveBroker, toNum, toneOf, tradeFills, type Instrument, type TradeRow } from "./calcLogic";
import { Callout, DateField, KV, NumField, Panel, SelectField, Stat, SymbolField } from "./CalcUi";

interface RowInput {
  id: string;
  instrument: Instrument;
  side: Side;
  entry: string;
  exit: string;
  lots: string;
  exchange: Exchange;
}

let rowSeq = 0;
const newId = () => `r${Date.now().toString(36)}${(rowSeq += 1)}`;

const INSTRUMENTS = [
  { value: "CE", label: "Call (CE)" },
  { value: "PE", label: "Put (PE)" },
  { value: "FUT", label: "Futures" },
] as const;
const SIDES = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
] as const;
const EXCHANGES = [
  { value: "NSE", label: "NSE" },
  { value: "BSE", label: "BSE" },
] as const;

const COMPONENTS: Array<{ key: keyof Omit<ChargesBreakdown, "total">; label: string; note: string }> = [
  { key: "brokerage", label: "Brokerage", note: "Per executed order" },
  { key: "stt", label: "STT", note: "Sell side, on premium (options) or price (futures)" },
  { key: "exchange", label: "Exchange txn charges", note: "On turnover" },
  { key: "sebi", label: "SEBI turnover fee", note: "₹10 per crore" },
  { key: "stamp", label: "Stamp duty", note: "Buy side only" },
  { key: "gst", label: "GST", note: "18% on brokerage, exchange and SEBI fees" },
];

function pctRate(v: number, dp = 4): string {
  return formatPct(v * 100, { decimals: dp });
}

export default function ChargesCalculator() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [lotSize, setLotSize] = useState(String(getLotSize("NIFTY") ?? 65));
  const [brokerId, setBrokerId] = useState("zerodha");
  const [customPerOrder, setCustomPerOrder] = useState("20");
  const [customPct, setCustomPct] = useState("");
  const [customCap, setCustomCap] = useState("");
  const [onDate, setOnDate] = useState(() => istDateString());
  const [rows, setRows] = useState<RowInput[]>(() => [
    { id: newId(), instrument: "CE", side: "BUY", entry: "120", exit: "150", lots: "1", exchange: "NSE" },
  ]);

  const broker = useMemo(
    () => resolveBroker(brokerId, { perOrder: toNum(customPerOrder), pctOfTurnover: toNum(customPct), cap: toNum(customCap) }),
    [brokerId, customPerOrder, customPct, customCap],
  );
  const rates = getChargeRates(onDate);
  const lot = toNum(lotSize);

  const changeSymbol = (s: string) => {
    setSymbol(s);
    setLotSize(String(getLotSize(s) ?? ""));
    const ex = getContractSpec(s)?.exchange ?? "NSE";
    setRows((rs) => rs.map((r) => ({ ...r, exchange: ex })));
  };

  const parsed: TradeRow[] = rows.map((r) => ({
    id: r.id,
    instrument: r.instrument,
    side: r.side,
    entry: toNum(r.entry),
    exit: r.exit.trim() === "" ? NaN : toNum(r.exit),
    lots: toNum(r.lots),
    lotSize: lot,
    exchange: r.exchange,
  }));
  const results = parsed.map((p) => analyseTrade(p, broker, onDate));
  const allFills = parsed.flatMap((p) => tradeFills(p));
  const total = calcCharges(allFills, { broker, onDate });
  const validCount = results.filter((r) => r.valid).length;
  const closed = results.filter((r) => r.valid && r.hasExit);
  const gross = closed.reduce((s, r) => s + r.gross, 0);
  const closedCharges = closed.reduce((s, r) => s + r.charges.total, 0);
  const net = gross - closedCharges;
  const turnover = results.reduce((s, r) => s + (r.valid ? r.turnover : 0), 0);

  const update = (id: string, patch: Partial<RowInput>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () =>
    setRows((rs) => [...rs, { id: newId(), instrument: "PE", side: "SELL", entry: "80", exit: "40", lots: "1", exchange: getContractSpec(symbol)?.exchange ?? "NSE" }]);
  const removeRow = (id: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Panel
          title="F&O charges"
          description="Enter each trade with its entry and exit price. Leave exit blank for an open position to see entry-side charges only."
          actions={<Badge variant="info">Rates from {formatDateIST(rates.effectiveFrom)}</Badge>}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
            <SymbolField value={symbol} onChange={changeSymbol} />
            <NumField label="Lot size" value={lotSize} onChange={setLotSize} invalid={!isPos(lot)} hint={!isPos(lot) ? "Enter a lot size" : "Units per lot"} />
            <SelectField label="Broker" value={brokerId} onChange={setBrokerId} options={BROKER_PRESETS.map((b) => ({ value: b.id, label: b.id === "custom" ? "Custom" : `${b.name} · ₹${b.perOrder}/order` }))} />
            <DateField label="Trade date" value={onDate} onChange={(v) => setOnDate(v || istDateString())} hint="Picks the STT rate in force" />
          </div>
          {brokerId === "custom" ? (
            <div className="mt-3 grid grid-cols-1 gap-3 rounded-md bg-control-track p-3 sm:grid-cols-3">
              <NumField label="Flat per order" prefix="₹" value={customPerOrder} onChange={setCustomPerOrder} />
              <NumField label="Or % of turnover" suffix="%" value={customPct} onChange={setCustomPct} placeholder="optional" hint="Used instead of flat when set" />
              <NumField label="Cap per order" prefix="₹" value={customCap} onChange={setCustomCap} placeholder="optional" hint="Defaults to the flat amount" />
            </div>
          ) : null}

          <ul className="mt-4 divide-y divide-separator overflow-hidden rounded-md border border-separator" aria-label="Trades">
            {rows.map((r, i) => {
              const res = results[i];
              return (
                <li key={r.id} className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-headline text-foreground">Trade {i + 1}</span>
                    <Button variant="ghost" size="icon" onClick={() => removeRow(r.id)} disabled={rows.length === 1} aria-label={`Remove trade ${i + 1}`}>
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <SelectField compact label="Type" value={r.instrument} onChange={(v) => update(r.id, { instrument: v })} options={INSTRUMENTS} />
                    <SelectField compact label="Entry side" value={r.side} onChange={(v) => update(r.id, { side: v })} options={SIDES} />
                    <NumField label={r.instrument === "FUT" ? "Entry price" : "Entry premium"} prefix="₹" value={r.entry} onChange={(v) => update(r.id, { entry: v })} invalid={!(toNum(r.entry) >= 0)} />
                    <NumField label="Exit" prefix="₹" value={r.exit} placeholder="open" onChange={(v) => update(r.id, { exit: v })} />
                    <NumField label="Lots" value={r.lots} onChange={(v) => update(r.id, { lots: v })} invalid={!isPos(toNum(r.lots))} />
                    <SelectField compact label="Exchange" value={r.exchange} onChange={(v) => update(r.id, { exchange: v })} options={EXCHANGES} />
                  </div>
                  {res.valid ? (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-body-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Quantity</dt>
                        <dd className="font-num tabular-nums">{formatNumberIN(res.qty)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Charges</dt>
                        <dd className="font-num tabular-nums">{formatINR(res.charges.total)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{res.hasExit ? "Net P&L" : "Gross P&L"}</dt>
                        <dd className={cn("font-num font-semibold tabular-nums", res.hasExit ? (res.net > 0 ? "text-bullish" : res.net < 0 ? "text-bearish" : "") : "text-muted-foreground")}>
                          {res.hasExit ? formatINR(res.net) : "Open"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Breakeven exit</dt>
                        <dd className="font-num tabular-nums">
                          {Number.isFinite(res.breakevenExit) ? (
                            <>
                              {formatINR(res.breakevenExit)} <span className="text-muted-foreground">({formatPoints(res.breakevenPoints)})</span>
                            </>
                          ) : (
                            <span className="font-sans text-warning">Cannot break even: charges exceed the premium</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-2 text-body-sm text-muted-foreground">Enter a price, lots and a lot size to see charges.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <Button variant="outline" size="sm" className="mt-3" onClick={addRow}>
            <Plus /> Add trade
          </Button>
        </Panel>

        <Panel title="Rate table in use" description="Statutory rates are applied as a fraction of turnover. Exchange and SEBI rates change from time to time; verify with your broker's contract note.">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <KV k="STT on option sell (premium)" v={pctRate(rates.sttOptionSell, 3)} />
            <KV k="STT on exercised options (intrinsic)" v={pctRate(rates.sttOptionExercise, 3)} />
            <KV k="STT on futures sell" v={pctRate(rates.sttFutSell, 3)} />
            <KV k="NSE option txn charge" v={pctRate(rates.nseTxnOpt)} />
            <KV k="BSE option txn charge" v={pctRate(rates.bseTxnOpt)} />
            <KV k="NSE futures txn charge" v={pctRate(rates.nseTxnFut)} />
            <KV k="SEBI fee" v={`₹${rates.sebiPerCrore} / crore`} />
            <KV k="Stamp duty (option / futures buy)" v={`${pctRate(rates.stampOptBuy, 3)} / ${pctRate(rates.stampFutBuy, 3)}`} />
            <KV k="GST" v={pctRate(rates.gst, 0)} />
            <KV k="Effective from" v={formatDateIST(rates.effectiveFrom)} />
          </div>
          <Callout tone="warning" className="mt-3">
            Charges are calculated from a dated rate table (STT revised from 1 Apr 2026). Verify the current rates with your broker before relying on these numbers.
          </Callout>
        </Panel>
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:self-start">
        <Panel title="Summary">
          {validCount === 0 ? (
            <p className="text-body text-muted-foreground">Add at least one complete trade to see the breakdown.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Total charges" value={formatINR(total.total)} emphasis tone="brand" />
                <Stat
                  label="Net P&L"
                  value={closed.length ? formatINR(net) : "—"}
                  tone={closed.length ? toneOf(net) : "default"}
                  emphasis
                  sub={closed.length ? `Gross ${formatINR(gross)}` : "No closed trades"}
                />
                <Stat label="Turnover" value={formatINR(turnover, { decimals: 0 })} />
                <Stat
                  label="Charges vs gross"
                  value={closed.length && gross > 0 ? formatPct((closedCharges / gross) * 100, { decimals: 1 }) : "—"}
                  sub={gross > 0 ? "of gross profit" : closed.length ? "Gross is not a profit" : undefined}
                />
              </div>
              <div className="mt-3 divide-y divide-separator">
                {COMPONENTS.map((c) => {
                  const v = total[c.key];
                  const share = total.total > 0 ? (v / total.total) * 100 : 0;
                  return (
                    <div key={c.key} className="py-2">
                      <div className="flex items-baseline justify-between gap-3 text-body">
                        <span title={c.note}>{c.label}</span>
                        <span className="font-num tabular-nums">{formatINR(v)}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-capsule bg-control-track" aria-hidden="true">
                        <div className="h-full rounded-capsule bg-primary" style={{ width: `${Math.min(100, share)}%` }} />
                      </div>
                      <div className="mt-0.5 flex justify-between text-micro text-muted-foreground">
                        <span>{c.note}</span>
                        <span>{formatPct(share, { decimals: 1 })}</span>
                      </div>
                    </div>
                  );
                })}
                <KV k="Total" v={formatINR(total.total)} strong className="pt-2" />
              </div>
            </>
          )}
        </Panel>
        <Panel title="Breakeven per lot" description="How far the price must move in your favour before the trade covers its own round-trip charges.">
          {results.some((r) => r.valid) ? (
            <ul className="divide-y divide-separator overflow-hidden rounded-md border border-separator">
              {results.map((r, i) =>
                r.valid ? (
                  <li key={rows[i].id} className="flex items-center justify-between gap-3 px-3 py-2 text-body">
                    <span>
                      Trade {i + 1} · {rows[i].side === "BUY" ? "Buy" : "Sell"} {rows[i].instrument}
                    </span>
                    <span className="text-right font-num tabular-nums">
                      {Number.isFinite(r.breakevenPoints) ? formatPoints(r.breakevenPoints) : <span className="font-sans text-warning">Cannot break even</span>}
                      <span className="block text-body-sm text-muted-foreground">{formatINR(r.chargesPerLot)} / lot</span>
                    </span>
                  </li>
                ) : null,
              )}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">No complete trades yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
