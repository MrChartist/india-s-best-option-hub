/**
 * Typed content model for the Learn hub (NISMExams.com partnership).
 * Pure data types only: no React, no DOM.
 */

export type MetricKey =
  | "iv"
  | "ivr"
  | "ivp"
  | "hv"
  | "vrp"
  | "pop"
  | "p50"
  | "ev"
  | "em"
  | "gex"
  | "flip"
  | "callWall"
  | "putWall"
  | "absGamma"
  | "dex"
  | "vanna"
  | "charm"
  | "rr25"
  | "bf25"
  | "maxPain"
  | "pcr"
  | "pcrChg"
  | "span"
  | "elm"
  | "stt"
  | "delta"
  | "gamma"
  | "theta"
  | "vega"
  | "rho"
  | "buildup"
  | "mwpl"
  | "basis"
  | "rollover"
  | "straddle";

/** How a live value passed to <MetricHelp value={…}/> should be formatted. */
export type MetricUnit = "pct" | "inr" | "inrCompact" | "points" | "ratio" | "score" | "greek" | "text";

export interface MetricInfo {
  key: MetricKey;
  title: string;
  /** Short label, e.g. "IVR". */
  short: string;
  /** One plain-English sentence. */
  oneLiner: string;
  /** Plain text / LaTeX-lite, e.g. "IVR = (IV − IVlow) ÷ (IVhigh − IVlow) × 100". */
  formula: string;
  howToRead: string;
  /** Worked example on an Indian contract (numbers computed with @/lib/options where possible). */
  indiaExample: string;
  pitfalls: string[];
  /** Slug of the lesson that teaches this metric. */
  lessonSlug: string;
  unit: MetricUnit;
}

export type PathId = "options-101" | "greeks" | "volatility" | "strategies" | "risk-costs" | "oi-pcr" | "gex-india";

export interface LearningPath {
  id: PathId;
  title: string;
  blurb: string;
  /** lucide-react icon name used by the hub. */
  icon: "BookOpen" | "Sigma" | "Activity" | "Layers" | "ShieldAlert" | "BarChart3" | "Magnet";
}

export type SimId = "payoff" | "ivStraddle" | "greeks" | "thetaDecay" | "pop" | "charges";

export type CalloutTone = "info" | "warning" | "success" | "danger";

/**
 * Lesson body blocks. Text supports **bold** and `code` inline marks only.
 * "contractTable" and "expiryList" render live tables from the instrument registry.
 */
export type LessonBlock =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "callout"; tone: CalloutTone; title: string; text: string }
  | { kind: "formula"; label?: string; text: string }
  | { kind: "table"; caption?: string; head: string[]; rows: string[][] }
  | { kind: "sim"; sim: SimId; caption?: string }
  | { kind: "metrics"; metrics: MetricKey[] }
  | { kind: "contractTable" }
  | { kind: "expiryList"; symbols: string[] }
  | { kind: "source"; label: string; href: string; note?: string };

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Index into options. */
  answer: number;
  explain: string;
}

export type LessonLevel = "Beginner" | "Intermediate" | "Advanced";

export interface Lesson {
  slug: string;
  path: PathId;
  title: string;
  summary: string;
  minutes: number;
  level: LessonLevel;
  /** Metrics this lesson teaches (drives MetricHelp "Learn more" links). */
  metrics: MetricKey[];
  sims: SimId[];
  blocks: LessonBlock[];
  quiz: QuizQuestion[];
}

export interface GlossaryTerm {
  term: string;
  /** Alternative spellings / abbreviations used for search. */
  aka?: string[];
  definition: string;
  metric?: MetricKey;
  lessonSlug?: string;
}
