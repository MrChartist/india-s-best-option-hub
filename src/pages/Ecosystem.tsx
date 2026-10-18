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
import { buttonVariants } from "@/components/ui/button";
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

const linkFocus = "focus-visible:shadow-focus focus-visible:outline-none";

function ProductCard({ p }: { p: Product }) {
  const Icon = PRODUCT_ICONS[p.id];
  const returning = p.status === "returning";
  return (
    <li className={cn("flex min-w-0 flex-col bg-card px-4 py-3", returning && "bg-surface")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-pill",
            returning ? "bg-control-track text-muted-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 font-display text-headline text-foreground">
            {p.name}
            {returning ? <span className="rounded-chip bg-control-track px-1.5 py-0.5 text-micro font-medium text-muted-foreground">Returning soon</span> : null}
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
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Open <ArrowUpRight aria-hidden="true" />
          </OutboundLink>
          <span className="ml-2 break-all text-body-sm text-muted-foreground-subtle">{new URL(p.url).host.replace(/^www\./, "")}</span>
        </div>
      )}
    </li>
  );
}

function SectionTitle({ id, children, sub }: { id: string; children: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="font-display text-lead font-semibold text-foreground">
        {children}
      </h2>
      {sub ? <p className="mt-0.5 text-body-sm text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function Ecosystem() {
  usePageMeta({
    title: "Mr. Chartist ecosystem",
    description: "Tools, research and courses from Mr. Chartist: FII/DII Data, IPO Decode, TradeBook, NISM Exams, the Weekly ChartBook and more.",
  });

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-6 px-1.5 py-1 sm:px-0">
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
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Star className="text-primary-ink" aria-hidden="true" /> Star on GitHub
            </OutboundLink>
            <OutboundLink
              url={ECOSYSTEM_PAGES.ecosystem}
              campaign="ecosystem-header"
              className={buttonVariants({ size: "sm" })}
            >
              mrchartist.com <ArrowUpRight aria-hidden="true" />
            </OutboundLink>
          </>
        }
      />

      {/* Products */}
      <section aria-labelledby="eco-products">
        <SectionTitle id="eco-products" sub="Each opens on its own site in a new tab.">
          Products
        </SectionTitle>
        {/* One group box; cell hairlines come from each cell's outline, so a short last row stays clean. */}
        <ul className="grid overflow-hidden rounded-tile border border-separator bg-card shadow-card sm:grid-cols-2 lg:grid-cols-3 [&>*]:shadow-[0_0_0_var(--hairline)_hsl(var(--separator))]">
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
        <ul className="grid overflow-hidden rounded-tile border border-separator bg-card shadow-card sm:grid-cols-2 [&>*]:shadow-[0_0_0_var(--hairline)_hsl(var(--separator))]">
          {LEARN_LINKS.map((l) => {
            const Icon = LEARN_ICONS[l.id] ?? BookMarked;
            return (
              <li key={l.id} className="min-w-0">
                <OutboundLink
                  url={l.url}
                  campaign="ecosystem-learn"
                  className={cn(
                    "group flex h-full min-w-0 items-start gap-3 px-3 py-2.5 transition-colors duration-fast hover:bg-control-track focus-visible:shadow-[inset_0_0_0_3px_hsl(var(--primary)/0.5)] focus-visible:outline-none",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-headline text-foreground">{l.name}</span>
                    <span className="block text-body-sm text-muted-foreground">{l.description}</span>
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground-subtle" aria-hidden="true" />
                </OutboundLink>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Socials */}
        <section aria-labelledby="eco-follow" className="rounded-card border border-separator bg-card p-4 shadow-card">
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
                    buttonVariants({ variant: "secondary" }),
                    "w-full min-w-0 justify-start",
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
        <section aria-labelledby="eco-github" className="flex flex-col rounded-card border border-separator bg-card p-4 shadow-card">
          <SectionTitle id="eco-github" sub="Option Hub is free for personal use, and the source is on GitHub. A star helps other traders find it.">
            Star Option Hub on GitHub
          </SectionTitle>
          <div className="mt-auto flex flex-wrap gap-2">
            <OutboundLink
              url={BRAND.repo}
              campaign="ecosystem-github"
              className={buttonVariants()}
            >
              <Github aria-hidden="true" /> Star on GitHub
            </OutboundLink>
            <OutboundLink
              url={BRAND.projectPage}
              campaign="ecosystem-github"
              className={buttonVariants({ variant: "secondary" })}
            >
              Project page <ArrowUpRight aria-hidden="true" />
            </OutboundLink>
          </div>
        </section>
      </div>

      {/* About */}
      <section aria-labelledby="eco-about" className="rounded-card border border-separator bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile border border-separator bg-card text-foreground shadow-card">
            <MrChartistMark size={24} decorative />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h2 id="eco-about" className="font-display text-lead font-semibold text-foreground">
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
                className={cn("font-semibold text-primary-ink underline-offset-4 hover:underline", linkFocus)}
              >
                Verify on sebi.gov.in
              </OutboundLink>
            </p>
            <p className="text-body-sm text-muted-foreground">{BRAND.disclaimer}</p>
            <p className="text-body-sm text-muted-foreground">
              {BRAND.licenceSummary}{" "}
              <a
                href={`mailto:${BRAND.licenceEmail}?subject=${encodeURIComponent("Option Hub commercial licence")}`}
                className={cn("font-semibold text-primary-ink underline-offset-4 hover:underline", linkFocus)}
              >
                {BRAND.licenceEmail}
              </a>
              {" · "}
              <a
                href={BRAND.licenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("font-semibold text-primary-ink underline-offset-4 hover:underline", linkFocus)}
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
