import { useEffect } from "react";
import { APP_NAME } from "@/lib/routes";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl, normaliseSiteUrl } from "@/lib/marketData/seo";

export const DEFAULT_DOCUMENT_TITLE = SITE_NAME;

/** Public site URL from VITE_SITE_URL ("" when unset: canonical tags are then left alone). */
export const SITE_URL: string = (() => {
  try {
    return normaliseSiteUrl(import.meta.env?.VITE_SITE_URL as string | undefined);
  } catch {
    return "";
  }
})();

/** "Option Chain" → "Option Chain · Option Hub by Mr. Chartist"; empty → the default app title. */
export function formatDocumentTitle(title: string): string {
  const t = title.trim();
  return t ? `${t} · ${APP_NAME}` : DEFAULT_DOCUMENT_TITLE;
}

/**
 * Set document.title for the current page, appending " · Option Hub by Mr. Chartist".
 * The previous title is restored on unmount.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = formatDocumentTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export interface PageMeta {
  /** Page title (" · Option Hub by Mr. Chartist" is appended). */
  title: string;
  /** Meta description; keep it under ~160 characters. Falls back to the site description. */
  description?: string;
  /**
   * Canonical path ("/option-chain") or absolute URL. Defaults to the current pathname. Ignored when
   * VITE_SITE_URL is not configured and the value is a path.
   */
  canonical?: string;
}

type Restore = () => void;

/** Set (creating if needed) a <meta> or <link> attribute; returns a function that undoes it. */
function setHeadAttr(selector: string, create: () => HTMLElement, attr: string, value: string): Restore {
  let el = document.head.querySelector<HTMLElement>(selector);
  const created = !el;
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  const prev = el.getAttribute(attr);
  el.setAttribute(attr, value);
  const node = el;
  return () => {
    if (created) node.remove();
    else if (prev === null) node.removeAttribute(attr);
    else node.setAttribute(attr, prev);
  };
}

function metaEl(key: "name" | "property", value: string): () => HTMLElement {
  return () => {
    const m = document.createElement("meta");
    m.setAttribute(key, value);
    return m;
  };
}

/** Resolve a canonical path or URL against the configured site URL ("" when it cannot be made absolute). */
export function resolveCanonical(canonical: string | undefined, pathname: string, site: string = SITE_URL): string {
  const c = (canonical ?? "").trim();
  if (/^https?:\/\//i.test(c)) return c;
  return absoluteUrl(site, c || pathname);
}

/**
 * Page-level SEO: title, description, canonical and the matching Open Graph / Twitter tags.
 * Everything is restored on unmount, so the next page starts from index.html's defaults.
 */
export function usePageMeta({ title, description, canonical }: PageMeta): void {
  const desc = (description ?? "").trim() || SITE_DESCRIPTION;
  useEffect(() => {
    if (typeof document === "undefined") return;
    const restores: Restore[] = [];
    const prevTitle = document.title;
    const fullTitle = formatDocumentTitle(title);
    document.title = fullTitle;
    restores.push(() => {
      document.title = prevTitle;
    });

    restores.push(setHeadAttr('meta[name="description"]', metaEl("name", "description"), "content", desc));
    restores.push(setHeadAttr('meta[property="og:title"]', metaEl("property", "og:title"), "content", fullTitle));
    restores.push(setHeadAttr('meta[property="og:description"]', metaEl("property", "og:description"), "content", desc));
    restores.push(setHeadAttr('meta[name="twitter:title"]', metaEl("name", "twitter:title"), "content", fullTitle));
    restores.push(setHeadAttr('meta[name="twitter:description"]', metaEl("name", "twitter:description"), "content", desc));

    const href = resolveCanonical(canonical, window.location.pathname);
    if (href) {
      restores.push(
        setHeadAttr(
          'link[rel="canonical"]',
          () => {
            const l = document.createElement("link");
            l.setAttribute("rel", "canonical");
            return l;
          },
          "href",
          href,
        ),
      );
      restores.push(setHeadAttr('meta[property="og:url"]', metaEl("property", "og:url"), "content", href));
    }

    return () => {
      for (let i = restores.length - 1; i >= 0; i--) restores[i]();
    };
  }, [title, desc, canonical]);
}
