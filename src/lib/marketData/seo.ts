/**
 * Site metadata builders shared by the build (vite.config.ts: sitemap.xml, robots.txt, canonical
 * and JSON-LD injected into index.html) and the runtime (usePageMeta in src/hooks/useDocumentTitle).
 *
 * Pure and dependency-free on purpose: vite.config.ts imports this file directly, where the "@/"
 * alias does not exist. The public site URL comes from VITE_SITE_URL; when it is not set, nothing
 * that needs an absolute URL (canonical, og:url, sitemap, robots Sitemap line) is emitted, rather
 * than pointing search engines at a wrong host.
 */

export const SITE_NAME = "Mr. Chartist Options Terminal";

export const SITE_DESCRIPTION =
  "Open-source NSE options analytics: option chain, open interest, Greeks, IV and strategy payoffs. Data for education and research. Not investment advice.";

/** "https://x.in/" → "https://x.in"; anything that is not an absolute http(s) URL → "". */
export function normaliseSiteUrl(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Absolute URL for an app path ("/option-chain") on `site`; "" when no site URL is configured. */
export function absoluteUrl(site: string, path = "/"): string {
  const base = normaliseSiteUrl(site);
  if (!base) return "";
  const clean = `/${String(path || "/").split(/[?#]/)[0].replace(/^\/+/, "")}`;
  return clean === "/" ? `${base}/` : `${base}${clean.replace(/\/+$/, "")}`;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Paths worth listing: static, non-wildcard, de-duplicated, home first. */
export function sitemapPaths(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    if (!p || p.includes(":") || p.includes("*")) continue;
    out.add(p.startsWith("/") ? p : `/${p}`);
  }
  return [...out].sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
}

/** sitemap.xml for `paths` on `site` (empty string when no site URL is configured). */
export function buildSitemapXml(site: string, paths: readonly string[], lastmod?: string): string {
  if (!normaliseSiteUrl(site)) return "";
  const rows = sitemapPaths(paths).map((p) => {
    const loc = xmlEscape(absoluteUrl(site, p));
    const parts = [`    <loc>${loc}</loc>`];
    if (lastmod) parts.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
    parts.push(`    <changefreq>${p === "/" ? "hourly" : "daily"}</changefreq>`);
    parts.push(`    <priority>${p === "/" ? "1.0" : "0.8"}</priority>`);
    return `  <url>\n${parts.join("\n")}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

/** robots.txt: allow everything; add the Sitemap line only when the site URL is known. */
export function buildRobotsTxt(site: string): string {
  const lines = ["User-agent: *", "Allow: /", "Disallow: /api/"];
  const sitemap = absoluteUrl(site, "/sitemap.xml");
  if (sitemap) lines.push("", `Sitemap: ${sitemap}`);
  return `${lines.join("\n")}\n`;
}

/** schema.org SoftwareApplication description of the terminal. */
export function softwareApplicationJsonLd(site: string): Record<string, unknown> {
  const url = absoluteUrl(site, "/");
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    alternateName: "Mr. Chartist Terminal",
    description: SITE_DESCRIPTION,
    applicationCategory: "FinanceApplication",
    applicationSubCategory: "Options analytics",
    operatingSystem: "Any (web browser)",
    inLanguage: "en-IN",
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses/MIT",
    codeRepository: "https://github.com/MrChartist/india-s-best-option-hub",
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
    author: { "@type": "Organization", name: "Mr. Chartist", url: "https://mrchartist.com" },
    featureList: [
      "NSE option chain with Greeks and IV",
      "Open interest, max pain and PCR",
      "Gamma exposure and volatility analytics",
      "Strategy builder with payoff, POP and margin",
      "Paper trading",
    ],
  };
  if (url) ld.url = url;
  return ld;
}

/** JSON-LD as a <script> body that cannot terminate the tag early. */
export function jsonLdScriptBody(ld: Record<string, unknown>): string {
  return JSON.stringify(ld).replace(/</g, "\\u003c");
}
