# syntax=docker/dockerfile:1.7
#
# Mr. Chartist Options Terminal: production image.
#   - Stage 1 (build): npm ci from the lockfile, then vite build.
#   - Stage 2 (runtime): serves dist/ on 4001 and runs the data proxy on 4002,
#     as the unprivileged `node` user, with a /health check.
#
# Secrets (Dhan keys) are never baked in: pass them at runtime with
# `--env-file .env` or docker-compose `env_file`.

ARG NODE_VERSION=22-alpine

# ── Build ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Where the browser reaches the proxy. The default works for `docker run -p 4002:4002`.
ARG VITE_PROXY_URL=http://localhost:4002
ARG VITE_DATA_MODE=
ENV VITE_PROXY_URL=${VITE_PROXY_URL} \
    VITE_DATA_MODE=${VITE_DATA_MODE}
RUN npm run build

# Runtime dependencies only (the proxy needs `ws`).
RUN npm prune --omit=dev --no-audit --no-fund

# ── Runtime ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production \
    PORT=4001 \
    PROXY_PORT=4002 \
    PROXY_HOST=0.0.0.0 \
    PROXY_ALLOWED_ORIGINS=http://localhost:4001,http://127.0.0.1:4001
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json /app/proxy-server.mjs ./

# Tiny dependency-free static server for dist/ (SPA fallback, long-cache hashed
# assets, security headers). It also supervises the proxy process: if either
# exits, the container exits and the orchestrator restarts it.
COPY --chown=node:node <<'EOF' /app/serve.mjs
import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve("dist");
const PORT = Number(process.env.PORT || 4001);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".map": "application/json",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function fileFor(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split("?")[0]); } catch { return null; }
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) return null;
  try { const s = statSync(full); return s.isFile() ? full : s.isDirectory() ? fileFor(join(p, "index.html")) : null; } catch { return null; }
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, SECURITY).end(); return; }
  if (req.url === "/healthz") { res.writeHead(200, { ...SECURITY, "Content-Type": "application/json" }).end('{"status":"ok"}'); return; }
  let file = fileFor(req.url || "/");
  const isAsset = /^\/assets\//.test(req.url || "");
  if (!file && isAsset) { res.writeHead(404, SECURITY).end("Not found"); return; }
  if (!file) file = join(ROOT, "index.html"); // SPA fallback for client routes
  const headers = {
    ...SECURITY,
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}).listen(PORT, "0.0.0.0", () => console.log(`  Static: http://0.0.0.0:${PORT} (dist)`));

const proxy = spawn(process.execPath, ["proxy-server.mjs"], { stdio: "inherit", env: process.env });
proxy.on("exit", (code, signal) => { console.error(`proxy exited (${signal || code}); stopping container`); process.exit(code || 1); });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { proxy.kill(sig); process.exit(0); });
EOF

RUN mkdir -p /app/.cache && chown node:node /app/.cache

USER node
EXPOSE 4001 4002

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PROXY_PORT}/health" >/dev/null && wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1

CMD ["node", "serve.mjs"]
