/**
 * PNG export for the payoff chart: clone the Recharts SVG, resolve CSS variables (hsl(var(--x)))
 * to concrete colours, serialise it, draw it onto a canvas with a title band and save the PNG.
 */

function rootVar(name: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  } catch {
    return "";
  }
}

/** Replace every var(--token) with its computed value so the SVG renders outside the page. */
export function resolveCssVars(value: string): string {
  return value.replace(/var\(--([\w-]+)\)/g, (_m, name: string) => rootVar(name) || "0 0% 50%");
}

const COLOUR_ATTRS = ["fill", "stroke", "stop-color", "color", "style", "flood-color"];

function inlineSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const walk = (el: Element) => {
    for (const attr of COLOUR_ATTRS) {
      const v = el.getAttribute(attr);
      if (v && v.includes("var(--")) el.setAttribute(attr, resolveCssVars(v));
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(clone);
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  clone.setAttribute("font-family", "Inter, system-ui, sans-serif");
  return new XMLSerializer().serializeToString(clone);
}

export async function exportChartPng(container: HTMLElement | null, opts: { title: string; subtitle: string; fileName: string }): Promise<boolean> {
  if (!container || typeof document === "undefined") return false;
  const svg = container.querySelector("svg.recharts-surface") as SVGSVGElement | null;
  if (!svg) return false;
  const markup = inlineSvg(svg);
  const { width, height } = svg.getBoundingClientRect();
  const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
  const pad = 24;
  const header = 64;
  const footer = 32;
  const W = Math.round(width + pad * 2);
  const H = Math.round(height + header + footer);
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.scale(scale, scale);
  const hsl = (name: string, alpha?: number) => {
    const raw = rootVar(name) || "0 0% 50%";
    return alpha === undefined ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
  };
  ctx.fillStyle = hsl("card");
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = hsl("foreground");
  ctx.font = "700 16px 'Plus Jakarta Sans', Inter, system-ui, sans-serif";
  ctx.fillText(opts.title, pad, 28);
  ctx.fillStyle = hsl("muted-foreground");
  ctx.font = "500 12px Inter, system-ui, sans-serif";
  let sub = opts.subtitle;
  const maxW = W - pad * 2;
  if (ctx.measureText(sub).width > maxW) {
    while (sub.length > 1 && ctx.measureText(`${sub}…`).width > maxW) sub = sub.slice(0, -1);
    sub = `${sub.trimEnd()}…`;
  }
  ctx.fillText(sub, pad, 48);
  ctx.fillText("Mr. Chartist Options Terminal · mrchartist.com · For education, not investment advice", pad, H - 12);

  const img = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load failed"));
      img.src = url;
    });
    ctx.drawImage(img, pad, header, width, height);
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return false;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = opts.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Download a text file (CSV) in the browser. */
export function downloadText(text: string, fileName: string, mime = "text/csv;charset=utf-8"): void {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    /* download blocked: nothing else to do */
  }
}
