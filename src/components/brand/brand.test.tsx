import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Ecosystem from "@/pages/Ecosystem";
import { BRAND, PRODUCTS } from "@/lib/brand/links";
import { MARK_PATHS } from "@/lib/brand/logo";
import { drawBrandMark, EXPORT_WATERMARK } from "@/components/strategy/exportPng";
import { MrChartistLogo, MrChartistMark } from "./MrChartistLogo";
import { BrandCrossLink, ProductCrossLink } from "./ProductCrossLink";
import { OutboundLink } from "./OutboundLink";
import { SocialIcon } from "./SocialIcon";

afterEach(cleanup);

describe("MrChartistMark", () => {
  it("is a titled image filled with currentColor", () => {
    render(<MrChartistMark size={20} />);
    const svg = screen.getByRole("img", { name: "Mr. Chartist" });
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg.querySelectorAll("path")).toHaveLength(MARK_PATHS.length);
  });

  it("hides itself from assistive tech when decorative", () => {
    const { container } = render(<MrChartistMark decorative />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.querySelector("title")).toBeNull();
  });
});

describe("MrChartistLogo", () => {
  it("renders the wordmark and product label in the lockup", () => {
    render(<MrChartistLogo />);
    expect(screen.getByText("Mr. Chartist")).toBeInTheDocument();
    expect(screen.getByText("Option Hub")).toBeInTheDocument();
  });

  it("renders only the mark, named with the product", () => {
    render(<MrChartistLogo variant="mark" />);
    expect(screen.getByRole("img", { name: "Mr. Chartist Option Hub" })).toBeInTheDocument();
  });

  it("can hide the product label", () => {
    render(<MrChartistLogo product={null} />);
    expect(screen.queryByText("Option Hub")).toBeNull();
  });
});

describe("OutboundLink", () => {
  it("tags the URL, opens a new tab and announces it", () => {
    render(
      <OutboundLink url="https://tradebook.mrchartist.com" campaign="journal" arrow>
        TradeBook
      </OutboundLink>,
    );
    const a = screen.getByRole("link", { name: /TradeBook \(opens in a new tab\)/ });
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
    expect(a.getAttribute("href")).toContain("utm_campaign=journal");
  });

  it("uses the label as the accessible name for icon-only links", () => {
    render(
      <OutboundLink url="https://x.com/Mr_Chartist" campaign="sidebar" label="Mr. Chartist on X">
        <SocialIcon id="x" />
      </OutboundLink>,
    );
    expect(screen.getByRole("link", { name: "Mr. Chartist on X (opens in a new tab)" })).toBeInTheDocument();
  });
});

describe("cross-links", () => {
  it("links a product with UTM tags in one line", () => {
    const { container } = render(<ProductCrossLink id="fiiDii" campaign="participants" blurb="Flows." />);
    const link = screen.getByRole("link", { name: /FII\/DII Data/ });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/fii-diidata\.mrchartist\.com\/\?utm_source=option-hub&utm_medium=app&utm_campaign=participants$/);
    expect(container.querySelector("[data-cross-link='fiiDii']")).not.toBeNull();
    expect(screen.getByText("Flows.")).toBeInTheDocument();
  });

  it("supports links that are not products", () => {
    render(<BrandCrossLink name="Learn options" url="https://mrchartist.com/learn/options" campaign="learn-hub" lead={null} />);
    expect(screen.getByRole("link", { name: /Learn options/ }).getAttribute("href")).toContain("utm_campaign=learn-hub");
  });
});

describe("SocialIcon", () => {
  it("renders every social id", () => {
    for (const id of ["x", "youtube", "telegram", "whatsapp", "instagram", "linkedin", "tradingview", "github"] as const) {
      const { container, unmount } = render(<SocialIcon id={id} />);
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });
});

describe("Ecosystem page", () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <Ecosystem />
      </MemoryRouter>,
    );

  it("has one h1 and sets the page title", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "More from Mr. Chartist" })).toBeInTheDocument();
    expect(document.title).toBe("Mr. Chartist ecosystem · Option Hub by Mr. Chartist");
  });

  it("opens every outbound link in a new tab with noopener", () => {
    renderPage();
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(10);
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("never adds UTM tags to the SEBI verification link", () => {
    renderPage();
    const sebi = screen.getByRole("link", { name: /Verify on sebi\.gov\.in/ });
    expect(sebi).toHaveAttribute("href", BRAND.sebiVerifyUrl);
    expect(screen.getByText(/SEBI Registered Research Analyst — INH000015297/)).toBeInTheDocument();
    expect(screen.getByText(BRAND.disclaimer)).toBeInTheDocument();
  });

  it("shows Scanner Pro as returning soon without an Open link", () => {
    renderPage();
    const card = screen.getByRole("heading", { level: 3, name: /Scanner Pro/ }).closest("li") as HTMLElement;
    expect(within(card).getByText("Returning soon")).toBeInTheDocument();
    expect(within(card).queryByRole("link")).toBeNull();
    const live = PRODUCTS.filter((p) => p.status === "live" && p.id !== "nismExams" && p.id !== "books");
    for (const p of live) expect(screen.getByRole("link", { name: `Open ${p.name} (opens in a new tab)` })).toBeInTheDocument();
  });
});

describe("PNG export watermark", () => {
  it("names the product", () => {
    expect(EXPORT_WATERMARK).toMatch(/^Option Hub by Mr\. Chartist/);
  });

  it("skips the mark without Path2D and draws every path with it", () => {
    const ctx = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), fill: vi.fn(), fillStyle: "" } as unknown as CanvasRenderingContext2D;
    const had = "Path2D" in globalThis;
    const original = (globalThis as { Path2D?: unknown }).Path2D;
    delete (globalThis as { Path2D?: unknown }).Path2D;
    expect(drawBrandMark(ctx, 0, 0, 14, "black")).toBe(false);
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(public d: string) {}
    };
    expect(drawBrandMark(ctx, 4, 4, 14, "black")).toBe(true);
    expect(ctx.fill).toHaveBeenCalledTimes(MARK_PATHS.length);
    expect(ctx.fillStyle).toBe("black");
    if (had) (globalThis as { Path2D?: unknown }).Path2D = original;
    else delete (globalThis as { Path2D?: unknown }).Path2D;
  });
});
