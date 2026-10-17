/// <reference types="vite/client" />
import { defineConfig, loadEnv, type Plugin, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { ROUTES, staticPaths } from "./src/lib/routes";
import {
  SITE_NAME,
  SITE_DESCRIPTION,
  absoluteUrl,
  buildRobotsTxt,
  buildSitemapXml,
  jsonLdScriptBody,
  normaliseSiteUrl,
  softwareApplicationJsonLd,
} from "./src/lib/marketData/seo";

// ── Vendor chunking ─────────────────────────────────────────────────────────
//
// Function form so transitive dependencies land with their parent library. The app shell
// (DashboardLayout) must not depend on vendor-charts or vendor-lwc: those load with the pages that
// draw charts, so dist/index.html only preloads vendor-react and vendor-ui.

const CHUNK_GROUPS: ReadonlyArray<[chunk: string, packages: readonly string[]]> = [
  ["vendor-charts", ["recharts", "victory-vendor", "react-smooth", "recharts-scale", "decimal.js-light", "internmap"]],
  ["vendor-lwc", ["lightweight-charts", "fancy-canvas"]],
  ["vendor-react", ["react", "react-dom", "react-router", "react-router-dom", "@remix-run/router", "scheduler", "clsx", "tailwind-merge"]],
];

/** "…/node_modules/@scope/pkg/dist/x.js" → "@scope/pkg"; null outside node_modules. */
export function packageNameOf(id: string): string | null {
  const norm = id.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/node_modules/");
  if (i < 0) return null;
  const parts = norm.slice(i + "/node_modules/".length).split("/");
  if (!parts[0]) return null;
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0];
}

export function vendorChunk(id: string): string | undefined {
  const pkg = packageNameOf(id);
  if (!pkg) return undefined;
  if (pkg.startsWith("d3-")) return "vendor-charts";
  if (pkg.startsWith("@tanstack/")) return "vendor-react";
  if (pkg.startsWith("@radix-ui/")) return "vendor-ui";
  for (const [chunk, pkgs] of CHUNK_GROUPS) if (pkgs.includes(pkg)) return chunk;
  return undefined;
}

// ── Dev server: tolerate malformed percent-escapes ──

/**
 * Return `url` unchanged when it decodes cleanly; otherwise percent-encode every "%" in its query
 * string (the path is left alone) so downstream decodeURI calls cannot throw.
 */
export function sanitizeMalformedQuery(url: string): string {
  try {
    decodeURI(url);
    return url;
  } catch {
    const q = url.indexOf("?");
    if (q < 0) return url;
    const hash = url.indexOf("#", q);
    const query = url.slice(q + 1, hash < 0 ? undefined : hash).replace(/%/g, "%25");
    return `${url.slice(0, q)}?${query}${hash < 0 ? "" : url.slice(hash)}`;
  }
}

// ── Site metadata: canonical, JSON-LD, sitemap.xml and robots.txt from ROUTES ──

function siteMetaPlugin(siteUrl: string): Plugin {
  const site = normaliseSiteUrl(siteUrl);
  const paths = staticPaths(ROUTES);
  const robots = buildRobotsTxt(site);
  return {
    name: "mr-chartist-site-meta",
    transformIndexHtml() {
      const tags: Array<{ tag: string; attrs?: Record<string, string>; children?: string; injectTo: "head" }> = [
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          children: jsonLdScriptBody(softwareApplicationJsonLd(site)),
          injectTo: "head",
        },
      ];
      const home = absoluteUrl(site, "/");
      if (home) {
        tags.push({ tag: "link", attrs: { rel: "canonical", href: home }, injectTo: "head" });
        tags.push({ tag: "meta", attrs: { property: "og:url", content: home }, injectTo: "head" });
      }
      return tags;
    },
    configureServer(server) {
      // A shared link with a malformed percent-escape (e.g. /watchlist?x=%E0%A4) makes Vite's dev
      // middlewares throw "URI malformed" (a 500 page plus an HMR error on every open tab). Escape the
      // stray "%" signs of a malformed query so the SPA fallback serves index.html as production does.
      server.middlewares.use((req, _res, next) => {
        if (req.url) req.url = sanitizeMalformedQuery(req.url);
        next();
      });
      // Serve the generated files in dev too, so links and crawler checks behave the same.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (url === "/robots.txt") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(robots);
          return;
        }
        if (url === "/sitemap.xml" && site) {
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          res.end(buildSitemapXml(site, paths));
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robots });
      if (site) {
        const lastmod = new Date().toISOString().slice(0, 10);
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: buildSitemapXml(site, paths, lastmod) });
      } else {
        this.warn("VITE_SITE_URL is not set: sitemap.xml, canonical and og:url were skipped.");
      }
    },
  };
}

// ── PWA (optional until vite-plugin-pwa is installed) ─────────────────────────

const PWA_MODULE = "vite-plugin-pwa";

type VitePWAFactory = (options: Record<string, unknown>) => PluginOption;

async function loadVitePWA(): Promise<VitePWAFactory | null> {
  try {
    const mod = (await import(/* @vite-ignore */ PWA_MODULE)) as { VitePWA?: VitePWAFactory };
    return typeof mod.VitePWA === "function" ? mod.VitePWA : null;
  } catch {
    return null;
  }
}

const ONE_YEAR_S = 60 * 60 * 24 * 365;

function pwaOptions(): Record<string, unknown> {
  return {
    // Registered by src/main.tsx (src/lib/marketData/serviceWorker.ts) with an "Update available" toast.
    registerType: "prompt",
    injectRegister: false,
    includeAssets: ["favicon.svg", "apple-touch-icon.png"],
    manifest: {
      name: SITE_NAME,
      short_name: "Mr. Chartist",
      description: SITE_DESCRIPTION,
      lang: "en-IN",
      dir: "ltr",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      theme_color: "#EE6125",
      background_color: "#F3F4EE",
      categories: ["finance", "education", "productivity"],
      icons: [
        { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/pwa-maskable-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: {
      // App shell only: hashed JS/CSS, the HTML entry, icons and fonts. Market data is never precached.
      globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      navigateFallback: "/index.html",
      navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/ws/, /^\/sitemap\.xml$/, /^\/robots\.txt$/],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          // Proxy routes on any origin (the proxy usually runs on another port): never serve a cached
          // quote as live. Offline, the request fails and the UI falls back to labelled sample data.
          urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/") || url.pathname === "/health",
          handler: "NetworkOnly",
        },
        {
          urlPattern: ({ url }: { url: URL }) => url.origin === "https://fonts.googleapis.com",
          handler: "StaleWhileRevalidate",
          options: { cacheName: "google-fonts-stylesheets", expiration: { maxEntries: 10, maxAgeSeconds: ONE_YEAR_S } },
        },
        {
          urlPattern: ({ url }: { url: URL }) => url.origin === "https://fonts.gstatic.com",
          handler: "StaleWhileRevalidate",
          options: {
            cacheName: "google-fonts-webfonts",
            expiration: { maxEntries: 30, maxAgeSeconds: ONE_YEAR_S },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
    devOptions: { enabled: false },
  };
}

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const VitePWA = mode === "test" ? null : await loadVitePWA();
  const plugins: PluginOption[] = [react(), siteMetaPlugin(env.VITE_SITE_URL ?? "")];
  if (VitePWA) plugins.push(VitePWA(pwaOptions()));

  return {
    server: {
      host: "0.0.0.0",
      port: 4001,
      hmr: {
        overlay: false,
      },
    },
    plugins,
    define: {
      // Lets src/main.tsx skip service-worker registration when the PWA plugin is not installed.
      "import.meta.env.VITE_PWA_ENABLED": JSON.stringify(VitePWA ? "true" : "false"),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: vendorChunk,
        },
      },
    },
  };
});
