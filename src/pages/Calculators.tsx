import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Calculator } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import ChargesCalculator from "@/components/calculators/ChargesCalculator";
import MarginCalculator from "@/components/calculators/MarginCalculator";
import PositionSizeCalculator from "@/components/calculators/PositionSizeCalculator";
import OptionPriceCalculator from "@/components/calculators/OptionPriceCalculator";
import IVCalculator from "@/components/calculators/IVCalculator";
import ExerciseSTTCalculator from "@/components/calculators/ExerciseSTTCalculator";
import FuturesBasisCalculator from "@/components/calculators/FuturesBasisCalculator";
import LotExpiryLookup from "@/components/calculators/LotExpiryLookup";

const TABS = [
  { value: "charges", label: "Charges", title: "Charges calculator", Comp: ChargesCalculator },
  { value: "margin", label: "Margin", title: "Margin calculator", Comp: MarginCalculator },
  { value: "size", label: "Position size", title: "Position size calculator", Comp: PositionSizeCalculator },
  { value: "price", label: "Option price", title: "Option price and Greeks", Comp: OptionPriceCalculator },
  { value: "iv", label: "IV", title: "IV calculator", Comp: IVCalculator },
  { value: "exercise", label: "Exercise STT", title: "Exercise STT calculator", Comp: ExerciseSTTCalculator },
  { value: "basis", label: "Futures basis", title: "Futures basis calculator", Comp: FuturesBasisCalculator },
  { value: "lots", label: "Lot & expiry", title: "Lot size and expiry lookup", Comp: LotExpiryLookup },
] as const;
type TabValue = (typeof TABS)[number]["value"];
const DEFAULT_TAB: TabValue = "charges";

export default function Calculators() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === raw) ? (raw as TabValue) : DEFAULT_TAB;
  const current = TABS.find((t) => t.value === tab) ?? TABS[0];
  useDocumentTitle(current.title);

  const setTab = useCallback(
    (t: string) => {
      const next = new URLSearchParams(params);
      if (t === DEFAULT_TAB) next.delete("tab");
      else next.set("tab", t);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <header className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-display">
          <Calculator className="h-6 w-6 text-primary-ink" aria-hidden="true" />
          Calculators
        </h1>
        <p className="mt-1 max-w-3xl text-body text-muted-foreground">
          F&O charges with the 2026 STT, SPAN-style margin, position sizing, option fair value and Greeks, implied volatility, exercise STT, futures basis and lot size lookup. Everything runs in your browser.
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1.5 overflow-x-auto px-1.5 sm:mx-0 sm:px-0">
          <TabsList className="w-max" aria-label="Calculators">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {TABS.map(({ value, Comp }) => (
          <TabsContent key={value} value={value} forceMount hidden={value !== tab} className="mt-4">
            <Comp />
          </TabsContent>
        ))}
      </Tabs>

      <p className="border-t border-border pt-3 text-body-sm text-muted-foreground">
        Data for education and research. Not investment advice. Charge rates, lot sizes and expiry rules come from a dated table marked for verification; margin is an estimate and actual exchange SPAN may differ. Confirm with your broker before trading.
      </p>
    </div>
  );
}
