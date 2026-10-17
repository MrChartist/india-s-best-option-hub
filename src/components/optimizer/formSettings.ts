import { CATEGORY_ORDER, type Pricing, type StrategyCategory } from "@/lib/optimizer";

export interface FormSettings {
  budget: number;
  maxLots: number;
  /** 0 = max chance, 1 = max return. */
  w: number;
  definedRiskOnly: boolean;
  strikesAroundAtm: number;
  minOiPct: number;
  maxSpreadPct: number;
  minPremium: number;
  pricing: Pricing;
  categories: StrategyCategory[];
}

export const DEFAULT_FORM_SETTINGS: FormSettings = {
  budget: 100000,
  maxLots: 10,
  w: 0.5,
  definedRiskOnly: true,
  strikesAroundAtm: 10,
  minOiPct: 0.03,
  maxSpreadPct: 0.08,
  minPremium: 2,
  pricing: "mid",
  categories: [...CATEGORY_ORDER],
};
