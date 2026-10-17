import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BROKER_PRESETS, formatINR, getChargeRates, istDateString, type ChargesBreakdown as Charges } from "@/lib/options";
import { MetricTip } from "./MetricTip";

export interface ChargesBreakdownProps {
  charges: Charges;
  brokerId: string;
  onBrokerId: (id: string) => void;
  roundTrip: boolean;
  onRoundTrip: (v: boolean) => void;
  orders: number;
  hasLongOptions: boolean;
}

export function ChargesBreakdown({ charges, brokerId, onBrokerId, roundTrip, onRoundTrip, orders, hasLongOptions }: ChargesBreakdownProps) {
  const rates = getChargeRates(istDateString());
  const rows: Array<{ label: string; value: number; help: string }> = [
    { label: "Brokerage", value: charges.brokerage, help: "Flat fee per executed order for the selected broker." },
    { label: "STT", value: charges.stt, help: `Securities Transaction Tax: ${(rates.sttOptionSell * 100).toFixed(3)}% of premium on option sells, ${(rates.sttFutSell * 100).toFixed(3)}% on futures sells.` },
    { label: "Exchange charges", value: charges.exchange, help: "NSE/BSE transaction charges on premium (options) or notional (futures)." },
    { label: "SEBI fee", value: charges.sebi, help: "₹10 per crore of turnover." },
    { label: "Stamp duty", value: charges.stamp, help: "Charged on the buy side only." },
    { label: "GST", value: charges.gst, help: "18% on brokerage, exchange charges and the SEBI fee." },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Receipt className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Charges
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={brokerId} onValueChange={onBrokerId}>
            <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Broker">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BROKER_PRESETS.map((b) => (
                <SelectItem key={b.id} value={b.id} className="text-xs">
                  {b.name}
                  {b.perOrder > 0 ? ` · ₹${b.perOrder}/order` : " · no brokerage"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="sb-roundtrip" checked={roundTrip} onCheckedChange={onRoundTrip} />
            <Label htmlFor="sb-roundtrip" className="text-xs">
              Include exit
            </Label>
          </div>
          <span className="text-[11px] text-muted-foreground">{orders} order{orders === 1 ? "" : "s"}</span>
        </div>
        <dl className="divide-y divide-border/60 rounded-tile border border-border text-xs">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-2.5 py-1.5">
              <dt className="flex items-center gap-1 text-muted-foreground">
                {r.label} <MetricTip label={r.label}>{r.help}</MetricTip>
              </dt>
              <dd className="font-num">{formatINR(r.value, { decimals: 2 })}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between bg-surface px-2.5 py-1.5 font-semibold">
            <dt>Total</dt>
            <dd className="font-num">{formatINR(charges.total, { decimals: 2 })}</dd>
          </div>
        </dl>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {roundTrip ? "Exit is priced at the entry premium, a conservative estimate." : "Entry orders only."} Rates effective {rates.effectiveFrom}.
          {hasLongOptions ? " Long options left to expire in the money attract exercise STT on the intrinsic value, which can be far higher than selling them before expiry." : ""}
        </p>
      </CardContent>
    </Card>
  );
}
