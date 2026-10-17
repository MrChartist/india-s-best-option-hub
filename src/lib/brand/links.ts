/**
 * Mr. Chartist brand facts and outbound links: the single source of truth for every URL that leaves
 * Option Hub. Facts were checked against mrchartist.com on 17 Oct 2026; do not add product claims
 * here that the product's own site does not make.
 *
 * Pure and dependency-free (no "@/" imports): vite.config.ts and seo.ts import it directly.
 */

export const BRAND = {
  name: "Mr. Chartist",
  owner: "Rohit Singh",
  tagline: "A clearer view of the markets.",
  site: "https://mrchartist.com",
  product: "Option Hub",
  /** Full product name used in titles, the manifest and the README. */
  productFull: "Option Hub by Mr. Chartist",
  projectPage: "https://mrchartist.com/open-source/india-s-best-option-hub",
  repo: "https://github.com/MrChartist/india-s-best-option-hub",
  xHandle: "@Mr_Chartist",
  /** Research entity and SEBI registration, as printed in the mrchartist.com footer. */
  researchEntity: "INVESTOLOGY",
  sebiRegNo: "INH000015297",
  sebiLine: "INVESTOLOGY · SEBI Registered Research Analyst — INH000015297",
  sebiVerifyUrl: "https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=14&regno=INH000015297",
  disclaimer: "Data for education and research. Not investment advice.",
} as const;

export const ECOSYSTEM_PAGES = {
  ecosystem: "https://mrchartist.com/ecosystem",
  products: "https://mrchartist.com/products",
  openSource: "https://mrchartist.com/open-source",
  learn: "https://mrchartist.com/learn",
  learnOptions: "https://mrchartist.com/learn/options",
  learnNism: "https://mrchartist.com/learn/nism",
  learnTradingView: "https://mrchartist.com/learn/tradingview/introduction",
  research: "https://mrchartist.com/research",
  books: "https://mrchartist.com/books",
  tools: "https://mrchartist.com/tools",
} as const;

export type ProductId =
  | "investology"
  | "fiiDii"
  | "optionsDesk"
  | "fundaDesk"
  | "ipoDecode"
  | "tradeBook"
  | "nismExams"
  | "chartBook"
  | "books"
  | "scannerPro";

export interface Product {
  id: ProductId;
  name: string;
  url: string;
  /** One line, taken from the product's own site. */
  description: string;
  /** "returning" products are listed without a primary link. */
  status: "live" | "returning";
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "fiiDii",
    name: "FII/DII Data",
    url: "https://fii-diidata.mrchartist.com",
    description: "Track real-time FII and DII institutional money flows, F&O positioning, sector-wise FPI allocation and flow heatmaps.",
    status: "live",
  },
  {
    id: "optionsDesk",
    name: "OptionsDesk",
    url: "https://optionsdesk.mrchartist.com",
    description: "More options tools from Mr. Chartist.",
    status: "live",
  },
  {
    id: "ipoDecode",
    name: "IPO Decode",
    url: "https://ipodecode.mrchartist.com",
    description: "Track every mainboard and SME IPO on NSE and BSE: live subscription, grey market premium, allotment status and listing performance.",
    status: "live",
  },
  {
    id: "tradeBook",
    name: "TradeBook",
    url: "https://tradebook.mrchartist.com",
    description: "Trading journal for Indian markets: NSE, MCX and F&O.",
    status: "live",
  },
  {
    id: "fundaDesk",
    name: "FundaDesk",
    url: "https://funda.mrchartist.com",
    description: "Fundamentals tools from Mr. Chartist.",
    status: "live",
  },
  {
    id: "investology",
    name: "Investology",
    url: "https://investology.mrchartist.com/",
    description: "SEBI-registered research from Mr. Chartist.",
    status: "live",
  },
  {
    id: "chartBook",
    name: "Weekly ChartBook",
    url: "https://mrchartist.com/research/category/chartbook",
    description: "280+ editions of premium visual chart analysis.",
    status: "live",
  },
  {
    id: "nismExams",
    name: "NISM Exams",
    url: "https://nismexams.com",
    description: "Notes, mock tests, explanations and performance tracking for NISM Series V-A, VIII, XV, X-A, X-B, XXI-A and XXI-B.",
    status: "live",
  },
  {
    id: "books",
    name: "Trading Books",
    url: "https://mrchartist.com/books",
    description: "Trading Candlestick Patterns and Trading Chart Patterns.",
    status: "live",
  },
  {
    id: "scannerPro",
    name: "Scanner Pro",
    url: "https://scanner.mrchartist.com",
    description: "Offline while it is rebuilt. Returning soon.",
    status: "returning",
  },
];

export function product(id: ProductId): Product {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown product: ${id}`);
  return p;
}

export interface LearnLink {
  id: string;
  name: string;
  url: string;
  description: string;
}

export const LEARN_LINKS: readonly LearnLink[] = [
  {
    id: "nism",
    name: "NISM Exams",
    url: "https://nismexams.com",
    description: "Notes and mock tests for NISM Series V-A, VIII, XV, X-A, X-B, XXI-A and XXI-B.",
  },
  { id: "options", name: "Learn options", url: ECOSYSTEM_PAGES.learnOptions, description: "Options lessons on mrchartist.com." },
  { id: "tradingview", name: "TradingView course", url: ECOSYSTEM_PAGES.learnTradingView, description: "Start with the introduction lesson." },
  { id: "books", name: "Books", url: ECOSYSTEM_PAGES.books, description: "Trading Candlestick Patterns and Trading Chart Patterns." },
];

export type SocialId = "x" | "youtube" | "telegram" | "instagram" | "linkedin" | "tradingview" | "github" | "whatsapp";

export interface Social {
  id: SocialId;
  label: string;
  url: string;
}

export const SOCIALS: readonly Social[] = [
  { id: "x", label: "X (@Mr_Chartist)", url: "https://x.com/Mr_Chartist" },
  { id: "youtube", label: "YouTube", url: "https://www.youtube.com/mr_chartist" },
  { id: "telegram", label: "Telegram", url: "https://t.me/official_mrchartist" },
  { id: "whatsapp", label: "WhatsApp channel", url: "https://whatsapp.com/channel/0029VaDUeH159PwXDwq8yI1I" },
  { id: "instagram", label: "Instagram", url: "https://instagram.com/mrchartist" },
  { id: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/in/rohit-mrchartist/" },
  { id: "tradingview", label: "TradingView", url: "https://tradingview.com/u/MrChartist" },
  { id: "github", label: "GitHub", url: "https://github.com/MrChartist" },
];

// ── UTM tagging ────────────────────────────────────────────────────────────

export const UTM_SOURCE = "option-hub";
export const UTM_MEDIUM = "app";

/** Hosts that must never get tracking parameters (government sites with strict query handling). */
const NO_UTM_HOSTS = ["sebi.gov.in"];

function hostBlocked(host: string): boolean {
  const h = host.toLowerCase();
  return NO_UTM_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

/** "Learn hub / NISM" → "learn-hub-nism". Empty input → "general". */
export function campaignSlug(raw: string): string {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "general";
}

/**
 * Append utm_source=option-hub, utm_medium=app and utm_campaign=<campaign> to an outbound URL.
 * Existing query parameters and the hash are kept, and existing utm_* values are never
 * overwritten. Relative URLs, non-http(s) URLs and sebi.gov.in links come back unchanged.
 */
export function withUtm(url: string, campaign: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return url;
  if (hostBlocked(u.hostname)) return url;
  const add: Array<[string, string]> = [
    ["utm_source", UTM_SOURCE],
    ["utm_medium", UTM_MEDIUM],
    ["utm_campaign", campaignSlug(campaign)],
  ];
  for (const [k, v] of add) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  return u.toString();
}

/** Props for an outbound <a>: tagged href, new tab, no opener or referrer. */
export function externalLinkProps(url: string, campaign: string): { href: string; target: "_blank"; rel: "noopener noreferrer" } {
  return { href: withUtm(url, campaign), target: "_blank", rel: "noopener noreferrer" };
}
