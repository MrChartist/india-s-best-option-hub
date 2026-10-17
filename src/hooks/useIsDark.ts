import { useEffect, useState } from "react";

/**
 * Reactively tracks whether the app is in dark mode by observing the
 * `dark` class on <html>. Works regardless of how the theme is toggled
 * (useTheme is local-state, so a MutationObserver is the reliable source
 * of truth for canvas / lightweight-charts that must repaint on change).
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

/**
 * Reads the live chart color palette from CSS custom properties so canvas /
 * lightweight-charts visuals match the active theme exactly. `isDark` is taken
 * as an argument purely so callers re-resolve colors whenever the theme flips.
 */
export function getChartColors(_isDark?: boolean) {
  // Mr. Chartist dark-mode values, used only when CSS variables cannot be read (SSR/tests).
  const fallback = {
    bullish: "148.9 45.5% 63.3%",
    bearish: "3 72% 66%",
    primary: "17.9 85.5% 53.9%",
    text: "72 6% 64%",
    grid: "212 14% 12%",
  };

  if (typeof window === "undefined") {
    return {
      bullish: `hsl(${fallback.bullish})`,
      bearish: `hsl(${fallback.bearish})`,
      primary: `hsl(${fallback.primary})`,
      text: `hsl(${fallback.text})`,
      grid: `hsl(${fallback.grid})`,
      bullishRaw: fallback.bullish,
      bearishRaw: fallback.bearish,
    };
  }

  const css = getComputedStyle(document.documentElement);
  const raw = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;

  const bullishRaw = raw("--bullish", fallback.bullish);
  const bearishRaw = raw("--bearish", fallback.bearish);

  return {
    bullish: `hsl(${bullishRaw})`,
    bearish: `hsl(${bearishRaw})`,
    primary: `hsl(${raw("--primary", fallback.primary)})`,
    text: `hsl(${raw("--muted-foreground", fallback.text)})`,
    grid: `hsl(${raw("--chart-grid", fallback.grid)})`,
    bullishRaw,
    bearishRaw,
  };
}
