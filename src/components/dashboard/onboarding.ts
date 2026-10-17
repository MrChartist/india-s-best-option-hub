/**
 * First-run tour: five short steps from the dashboard to the option chain, Strategy Builder,
 * Paper Trading and Learn. Progress lives in localStorage (every access wrapped in try/catch), so a
 * blocked or private-mode browser simply shows the tour again next time.
 */

export const TOUR_KEY = "mc_onboarding_tour_v1";

export interface TourStep {
  id: "welcome" | "chain" | "builder" | "paper" | "learn";
  title: string;
  body: string;
  /** Where the step's main button goes; the welcome step stays on the dashboard. */
  to?: string;
  cta?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Mr. Chartist Terminal",
    body: "A free, open-source options terminal for NSE and BSE. Every number carries a source tag: Live, Delayed, Last saved or Sample. Without the local proxy you see labelled sample data, so you can explore safely.",
  },
  {
    id: "chain",
    title: "Start with the option chain",
    body: "See OI, change in OI, IV and Greeks per strike, with max pain, PCR and the ATM straddle in the header. Use the B and S buttons on a strike to add legs to a basket.",
    to: "/option-chain?symbol=NIFTY",
    cta: "Open option chain",
  },
  {
    id: "builder",
    title: "Build and stress-test a strategy",
    body: "Strategy Builder shows the payoff, probability of profit, margin with hedge benefit and charges net of STT. Slide the date and IV to see how the position behaves before expiry.",
    to: "/strategy-builder",
    cta: "Open Strategy Builder",
  },
  {
    id: "paper",
    title: "Practise with paper trading",
    body: "Send the strategy to Paper Trading to place orders at mid price with slippage, set stop-loss and target, and see expiry settlement with exercise STT. No real money is involved.",
    to: "/paper-trading",
    cta: "Open Paper Trading",
  },
  {
    id: "learn",
    title: "Learn as you go",
    body: "Every metric has an info icon with the formula and an Indian example. The Learn hub, by NISMExams.com, walks through options from the basics to Greeks and expiry-day risk.",
    to: "/learn",
    cta: "Open Learn",
  },
];

export interface TourState {
  /** Index of the step to show next. */
  step: number;
  /** True once the reader finishes or dismisses the tour. */
  done: boolean;
}

export const INITIAL_TOUR: TourState = { step: 0, done: false };

export function sanitizeTour(raw: unknown): TourState {
  if (!raw || typeof raw !== "object") return { ...INITIAL_TOUR };
  const r = raw as { step?: unknown; done?: unknown };
  const step = typeof r.step === "number" && Number.isInteger(r.step) ? Math.min(Math.max(r.step, 0), TOUR_STEPS.length - 1) : 0;
  return { step, done: r.done === true };
}

function storageOrNull(s?: Storage | null): Storage | null {
  if (s !== undefined) return s;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadTour(storage?: Storage | null): TourState {
  try {
    const raw = storageOrNull(storage)?.getItem(TOUR_KEY);
    return sanitizeTour(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...INITIAL_TOUR };
  }
}

export function saveTour(state: TourState, storage?: Storage | null): void {
  try {
    storageOrNull(storage)?.setItem(TOUR_KEY, JSON.stringify(sanitizeTour(state)));
  } catch {
    /* blocked or full: the tour shows again next visit */
  }
}

export type TourAction = { type: "next" } | { type: "back" } | { type: "goto"; step: number } | { type: "dismiss" } | { type: "restart" };

/** Tour reducer. "next" on the last step finishes the tour. */
export function tourReducer(state: TourState, action: TourAction): TourState {
  const last = TOUR_STEPS.length - 1;
  switch (action.type) {
    case "next":
      return state.step >= last ? { step: last, done: true } : { step: state.step + 1, done: false };
    case "back":
      return { step: Math.max(0, state.step - 1), done: false };
    case "goto":
      return { step: Math.min(Math.max(Math.trunc(action.step), 0), last), done: false };
    case "dismiss":
      return { ...state, done: true };
    case "restart":
      return { ...INITIAL_TOUR };
  }
}
