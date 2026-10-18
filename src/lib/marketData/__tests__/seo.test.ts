import { describe, expect, it } from "vitest";
import {
  OG_IMAGE_FALLBACK,
  PROJECT_PAGE_URL,
  SITE_NAME,
  absoluteUrl,
  canonicalHome,
  buildRobotsTxt,
  buildSitemapXml,
  jsonLdScriptBody,
  normaliseSiteUrl,
  sitemapPaths,
  softwareApplicationJsonLd,
} from "@/lib/marketData/seo";
import { ROUTES, staticPaths } from "@/lib/routes";

describe("normaliseSiteUrl / absoluteUrl", () => {
  it("accepts absolute http(s) URLs and strips trailing slashes, query and hash", () => {
    expect(normaliseSiteUrl("https://options.example.in/")).toBe("https://options.example.in");
    expect(normaliseSiteUrl(" https://x.in/app/?a=1#b ")).toBe("https://x.in/app");
    expect(normaliseSiteUrl("ftp://x.in")).toBe("");
    expect(normaliseSiteUrl("not a url")).toBe("");
    expect(normaliseSiteUrl(undefined)).toBe("");
  });
  it("joins paths and returns empty without a site", () => {
    expect(absoluteUrl("https://x.in/", "/")).toBe("https://x.in/");
    expect(absoluteUrl("https://x.in", "option-chain/")).toBe("https://x.in/option-chain");
    expect(absoluteUrl("https://x.in", "/oi?x=1#y")).toBe("https://x.in/oi");
    expect(absoluteUrl("https://x.in")).toBe("https://x.in/");
    expect(absoluteUrl("", "/oi")).toBe("");
  });
});

describe("sitemap", () => {
  it("keeps static paths, home first, without duplicates or params", () => {
    expect(sitemapPaths(["/oi", "/", "/learn/:slug", "*", "oi", "/a"])).toEqual(["/", "/a", "/oi"]);
  });
  it("builds a valid urlset for every static route", () => {
    const xml = buildSitemapXml("https://x.in", staticPaths(ROUTES), "2026-10-17");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<loc>https://x.in/</loc>");
    expect(xml).toContain("<loc>https://x.in/option-chain</loc>");
    expect(xml).toContain("<lastmod>2026-10-17</lastmod>");
    expect(xml).not.toContain(":slug");
    expect((xml.match(/<url>/g) ?? []).length).toBe(sitemapPaths(staticPaths(ROUTES)).length);
  });
  it("escapes XML and is empty without a site URL", () => {
    expect(buildSitemapXml("https://x.in", ["/a&b"])).toContain("https://x.in/a&amp;b");
    expect(buildSitemapXml("", ["/"])).toBe("");
  });
});

describe("robots.txt", () => {
  it("adds the Sitemap line only when the site is known", () => {
    expect(buildRobotsTxt("https://x.in")).toContain("Sitemap: https://x.in/sitemap.xml");
    expect(buildRobotsTxt("")).not.toContain("Sitemap");
    expect(buildRobotsTxt("")).toContain("Disallow: /api/");
  });
});

describe("JSON-LD", () => {
  it("describes a free finance SoftwareApplication priced in INR", () => {
    const ld = softwareApplicationJsonLd("https://x.in");
    expect(ld).toMatchObject({ "@type": "SoftwareApplication", name: SITE_NAME, applicationCategory: "FinanceApplication", url: "https://x.in/" });
    expect(ld.offers).toMatchObject({ price: "0", priceCurrency: "INR" });
    expect(softwareApplicationJsonLd("")).toHaveProperty("url", PROJECT_PAGE_URL);
    expect(softwareApplicationJsonLd("")).toHaveProperty("image", OG_IMAGE_FALLBACK);
    expect(ld).toHaveProperty("image", "https://x.in/og-image.png");
  });
  it("cannot close the script tag early", () => {
    expect(jsonLdScriptBody({ a: "</script><script>" })).not.toContain("</script>");
  });
});

describe("canonicalHome", () => {
  it("prefers the configured site and falls back to the mrchartist.com project page", () => {
    expect(canonicalHome("https://x.in")).toBe("https://x.in/");
    expect(canonicalHome("")).toBe(PROJECT_PAGE_URL);
    expect(PROJECT_PAGE_URL).toBe("https://mrchartist.com/open-source/india-s-best-option-hub");
    expect(SITE_NAME).toBe("Option Hub by Mr. Chartist");
  });
});
