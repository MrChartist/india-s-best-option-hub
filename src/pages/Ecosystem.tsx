import type { ComponentType } from "react";
import {
  ArrowUpRight,
  Blocks,
  BookMarked,
  Building2,
  ChartCandlestick,
  Github,
  GraduationCap,
  Landmark,
  Layers,
  Newspaper,
  NotebookPen,
  Rocket,
  ScanLine,
  ShieldCheck,
  Star,
  type LucideProps,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { MrChartistMark } from "@/components/brand/MrChartistLogo";
import { OutboundLink } from "@/components/brand/OutboundLink";
import { SocialIcon } from "@/components/brand/SocialIcon";
import { usePageMeta } from "@/hooks/useDocumentTitle";
import { BRAND, ECOSYSTEM_PAGES, LEARN_LINKS, PRODUCTS, SOCIALS, type Product, type ProductId } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

const PRODUCT_ICONS: Record<ProductId, ComponentType<LucideProps>> = {
  fiiDii: Landmark,
  optionsDesk: Layers,
  ipoDecode: Rocket,
  tradeBook: NotebookPen,
  fundaDesk: Building2,
  investology: ShieldCheck,
  chartBook: Newspaper,
  nismExams: GraduationCap,
  books: BookMarked,
  scannerPro: ScanLine,
};

const LEARN_ICONS: Record<string, ComponentType<LucideProps>> = {
  nism: GraduationCap,
  options: Layers,
  tradingview: ChartCandlestick,
  books: BookMarked,
};

/** Products shown in the main grid. NISM Exams and the books sit in the Learn section instead. */
const TOOL_PRODUCTS = PRODUCTS.filter((p) => p.id !== "nismExams" && p.id !== "books");

const CAMPAIGN = "ecosystem";

const linkFocus = "focus-visible:shadow-ember focus-visible:outline-none";

function ProductCard({ p }: { p: Product }) {
  const Icon = PRODUCT_ICONS[p.id];
  const returning = p.status === "returning";
  return (
    <li className={cn("flex min-w-0 flex-col rounded-card border border-border bg-card p-4 shadow-card", returning && "bg-surface/60 shadow-none")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-tile border border-border bg-surface",
            returning ? "text-muted-foreground" : "text-primary-ink",
          )}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-lead font-bold text-foreground">
            {p.name}
            {returning ? <span className="rounded-chip bg-muted px-1.5 py-0.5 text-micro uppercase text-muted-foreground">Returning soon</span> : null}
          </h3>
          <p className="mt-1 text-body-sm text-muted-foreground">{p.description}</p>
        </div>
      </div>
      {returning ? null : (
        <div className="mt-auto pt-3">
          <OutboundLink
            url={p.url}
            campaign={CAMPAIGN}
            label={`Open ${p.name}`}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-pill border border-border bg-background px-3 text-body-sm font-semibold text-foreground transition-colors duration-fast hover:border-primary/50 hover:text-primary-ink",
              linkFocus,
            )}
          >
            Open <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </OutboundLink>
          <span className="ml-2 break-all text-micro font-medium normal-case tracking-normal text-muted-foreground-subtle">{new URL(p.url).host.replace(/^www\./, "")}</span>
        </div>
      )}
    </li>
  );
}

function SectionTitle({ id, children, sub }: { id: string; children: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="font-display text-title text-foreground">
        {children}
      </h2>
      {sub ? <p className="mt-1 text-body text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function Ecosystem() {
  usePageMeta({
    title: "Mr. Chartist ecosystem",
    description: "Tools, research and courses from Mr. Chartist: FII/DII Data, IPO Decode, TradeBook, NISM Exams, the Weekly ChartBook and more.",
  });

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-8 px-1.5 py-1 sm:px-0">
      <PageHeader
        icon={Blocks}
        eyebrow="Mr. Chartist ecosystem"
        title="More from Mr. Chartist"
        description={`${BRAND.tagline} Option Hub is one part of the Mr. Chartist ecosystem of tools, research and courses for Indian markets.`}
        actions={
          <>
            <OutboundLink
              url={BRAND.repo}
              campaign="ecosystem-header"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-pill border border-border bg-card px-3.5 text-body font-semibold text-foreground shadow-card transition-colors duration-fast hover:border-primary/50",
                linkFocus,
              )}
            >
              <Star className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Star on GitHub
            </OutboundLink>
            <OutboundLink
              url={ECOSYSTEM_PAGES.ecosystem}
              campaign="ecosystem-header"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-pill bg-primary px-3.5 text-body font-semibold text-primary-foreground shadow-card transition-colors duration-fast hover:bg-primary-hover",
                linkFocus,
              )}
            >
              mrchartist.com <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </OutboundLink>
          </>
        }
      />

      {/* Products */}
      <section aria-labelledby="eco-products">
        <SectionTitle id="eco-products" sub="Each opens on its own site in a new tab.">
          Products
        </SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOOL_PRODUCTS.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </ul>
      </section>

      {/* Learn */}
      <section aria-labelledby="eco-learn">
        <SectionTitle id="eco-learn" sub="Courses, exam prep and books. The in-app Learn hub covers options basics to GEX.">
          Learn
        </SectionTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {LEARN_LINKS.map((l) => {
            const Icon = LEARN_ICONS[l.id] ?? BookMarked;
            return (
              <li key={l.id} className="min-w-0">
                <OutboundLink
                  url={l.url}
                  campaign="ecosystem-learn"
                  className={cn(
                    "group flex h-full min-w-0 items-start gap-3 rounded-tile border border-border bg-card px-3 py-2.5 transition-colors duration-fast hover:border-primary/40 hover:bg-surface",
                    linkFocus,
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-foreground">{l.name}</span>
                    <span className="block text-body-sm text-muted-foreground">{l.description}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary-ink" aria-hidden="true" />
                </OutboundLink>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Socials */}
        <section aria-labelledby="eco-follow" className="rounded-card border border-border bg-card p-4 shadow-card sm:p-5">
          <SectionTitle id="eco-follow" sub="Market views, charts and updates.">
            Follow for market views
          </SectionTitle>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {SOCIALS.map((s) => (
              <li key={s.id} className="min-w-0">
                <OutboundLink
                  url={s.url}
                  campaign="ecosystem-follow"
                  className={cn(
                    "flex h-9 min-w-0 items-center gap-2 rounded-pill border border-border bg-background px-3 text-body-sm font-medium text-foreground transition-colors duration-fast hover:border-primary/40 hover:text-primary-ink",
                    linkFocus,
                  )}
                >
                  <SocialIcon id={s.id} className="shrink-0" />
                  <span className="truncate">{s.id === "x" ? "X" : s.label}</span>
                </OutboundLink>
              </li>
            ))}
          </ul>
        </section>

        {/* GitHub */}
        <section aria-labelledby="eco-github" className="flex flex-col rounded-card border border-border bg-card p-4 shadow-card sm:p-5">
          <SectionTitle id="eco-github" sub="Option Hub is free for personal use, and the source is on GitHub. A star helps other traders find it.">
            Star Option Hub on GitHub
          </SectionTitle>
          <div className="mt-auto flex flex-wrap gap-2">
            <OutboundLink
              url={BRAND.repo}
              campaign="ecosystem-github"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-pill bg-foreground px-3.5 text-body font-semibold text-background transition-opacity duration-fast hover:opacity-90",
                linkFocus,
              )}
            >
              <Github className="h-4 w-4" aria-hidden="true" /> Star on GitHub
            </OutboundLink>
            <OutboundLink
              url={BRAND.projectPage}
              campaign="ecosystem-github"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-pill border border-border bg-background px-3.5 text-body font-semibold text-foreground transition-colors duration-fast hover:border-primary/40",
                linkFocus,
              )}
            >
              Project page <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </OutboundLink>
          </div>
        </section>
      </div>

      {/* About */}
      <section aria-labelledby="eco-about" className="rounded-card border border-border bg-surface/60 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-tile border border-border bg-card text-foreground shadow-card">
            <MrChartistMark size={30} decorative />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h2 id="eco-about" className="font-display text-lead font-bold text-foreground">
              About Mr. Chartist
            </h2>
            <p className="text-body text-foreground">
              Mr. Chartist is the market research and education brand of {BRAND.owner}.
            </p>
            <p className="text-body-sm text-muted-foreground">
              {BRAND.sebiLine}.{" "}
              <OutboundLink
                url={BRAND.sebiVerifyUrl}
                campaign="ecosystem-about"
                className={cn("font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary", linkFocus)}
              >
                Verify on sebi.gov.in
              </OutboundLink>
            </p>
            <p className="text-body-sm text-muted-foreground">{BRAND.disclaimer}</p>
            <p className="text-body-sm text-muted-foreground">
              {BRAND.licenceSummary}{" "}
              <a
                href={`mailto:${BRAND.licenceEmail}?subject=${encodeURIComponent("Option Hub commercial licence")}`}
                className={cn("font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary", linkFocus)}
              >
                {BRAND.licenceEmail}
              </a>
              {" · "}
              <a
                href={BRAND.licenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary", linkFocus)}
              >
                Licence terms<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
