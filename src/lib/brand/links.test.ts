import { describe, expect, it } from "vitest";
import {
  BRAND,
  LEARN_LINKS,
  PRODUCTS,
  SOCIALS,
  campaignSlug,
  externalLinkProps,
  product,
  withUtm,
} from "./links";

describe("withUtm", () => {
  it("adds source, medium and campaign", () => {
    const u = new URL(withUtm("https://fii-diidata.mrchartist.com", "participants"));
    expect(u.searchParams.get("utm_source")).toBe("option-hub");
    expect(u.searchParams.get("utm_medium")).toBe("app");
    expect(u.searchParams.get("utm_campaign")).toBe("participants");
  });

  it("keeps existing query parameters and the hash", () => {
    const out = withUtm("https://mrchartist.com/learn?x=1#top", "learn");
    const u = new URL(out);
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.hash).toBe("#top");
    expect(out.indexOf("#top")).toBeGreaterThan(out.indexOf("utm_campaign"));
  });

  it("never overwrites an existing utm value", () => {
    const u = new URL(withUtm("https://mrchartist.com/?utm_source=newsletter", "x"));
    expect(u.searchParams.getAll("utm_source")).toEqual(["newsletter"]);
    expect(u.searchParams.get("utm_campaign")).toBe("x");
  });

  it("leaves sebi.gov.in links untouched", () => {
    expect(withUtm(BRAND.sebiVerifyUrl, "about")).toBe(BRAND.sebiVerifyUrl);
    expect(withUtm("https://sebi.gov.in/x", "about")).toBe("https://sebi.gov.in/x");
  });

  it("does not block hosts that merely end with the same letters", () => {
    expect(withUtm("https://notsebi.gov.in.example.com/", "a")).toContain("utm_source=option-hub");
  });

  it("returns relative, malformed and non-http URLs unchanged", () => {
    expect(withUtm("/ecosystem", "a")).toBe("/ecosystem");
    expect(withUtm("not a url", "a")).toBe("not a url");
    expect(withUtm("mailto:hi@example.com", "a")).toBe("mailto:hi@example.com");
  });

  it("slugs the campaign", () => {
    expect(new URL(withUtm("https://x.com/Mr_Chartist", "Learn hub / NISM")).searchParams.get("utm_campaign")).toBe("learn-hub-nism");
  });
});

describe("campaignSlug", () => {
  it("falls back to general and trims length", () => {
    expect(campaignSlug("")).toBe("general");
    expect(campaignSlug("  --  ")).toBe("general");
    expect(campaignSlug("a".repeat(100))).toHaveLength(60);
  });
});

describe("externalLinkProps", () => {
  it("opens in a new tab without opener or referrer", () => {
    const p = externalLinkProps("https://tradebook.mrchartist.com", "journal");
    expect(p.target).toBe("_blank");
    expect(p.rel).toBe("noopener noreferrer");
    expect(p.href).toContain("utm_campaign=journal");
  });
});

describe("link registry", () => {
  it("uses https for every outbound URL", () => {
    const urls = [...PRODUCTS.map((p) => p.url), ...SOCIALS.map((s) => s.url), ...LEARN_LINKS.map((l) => l.url), BRAND.site, BRAND.repo, BRAND.projectPage, BRAND.sebiVerifyUrl];
    for (const url of urls) expect(new URL(url).protocol).toBe("https:");
  });

  it("has unique product ids and looks products up by id", () => {
    const ids = PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(product("tradeBook").url).toBe("https://tradebook.mrchartist.com");
    expect(() => product("nope" as never)).toThrow(/Unknown product/);
  });

  it("marks Scanner Pro as returning soon", () => {
    expect(product("scannerPro").status).toBe("returning");
  });

  it("carries the SEBI registration number in the compliance line", () => {
    expect(BRAND.sebiLine).toContain(BRAND.sebiRegNo);
    expect(BRAND.sebiVerifyUrl).toContain(`regno=${BRAND.sebiRegNo}`);
  });
});
