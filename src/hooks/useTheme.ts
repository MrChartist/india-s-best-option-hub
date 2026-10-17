import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type ThemeMode = Theme | "system";

export const THEME_STORAGE_KEY = "theme";
export const THEME_COLORS: Record<Theme, string> = { light: "#F3F4EE", dark: "#060809" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Pure: which concrete theme a mode resolves to. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): Theme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

/** Pure: next mode for the two-state toggle button (always lands on an explicit choice). */
export function nextToggleMode(current: Theme): ThemeMode {
  return current === "dark" ? "light" : "dark";
}

/** Pure: validate a raw stored value. Anything unknown means "system". */
export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function readStoredMode(): ThemeMode {
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/* ── Shared store so every caller (sidebar toggle, settings, charts) stays in sync ── */
interface ThemeState {
  mode: ThemeMode;
  theme: Theme;
}

let state: ThemeState | null = null;
const serverSnapshot: ThemeState = { mode: "system", theme: "light" };
const listeners = new Set<() => void>();

function getState(): ThemeState {
  if (state) return state;
  if (typeof window === "undefined") return serverSnapshot;
  const mode = readStoredMode();
  state = { mode, theme: resolveTheme(mode, systemPrefersDark()) };
  return state;
}

function applyToDocument(next: ThemeState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", next.theme === "dark");
  root.style.colorScheme = next.theme;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  metas.forEach((meta) => {
    if (next.mode === "system") {
      const media = meta.getAttribute("media") ?? "";
      meta.content = media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    } else {
      meta.content = THEME_COLORS[next.theme];
    }
  });
}

function setState(next: ThemeState) {
  const prev = getState();
  state = next;
  applyToDocument(next);
  if (prev.mode !== next.mode || prev.theme !== next.theme) listeners.forEach((l) => l());
}

function setModeInternal(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage blocked: keep the in-memory choice */
  }
  setState({ mode, theme: resolveTheme(mode, systemPrefersDark()) });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Three-state theme: light, dark or system (follows the OS, live).
 * Return shape is backwards compatible: { theme, toggle, isDark } plus { mode, setMode }.
 */
export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getState, () => serverSnapshot);

  // Follow OS changes while in "system" mode, and other tabs changing the stored mode.
  useEffect(() => {
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia(DARK_QUERY);
    } catch {
      mql = null;
    }
    const onSystem = () => {
      const cur = getState();
      if (cur.mode === "system") setState({ mode: "system", theme: resolveTheme("system", systemPrefersDark()) });
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) return;
      const mode = parseThemeMode(e.newValue);
      setState({ mode, theme: resolveTheme(mode, systemPrefersDark()) });
    };
    mql?.addEventListener?.("change", onSystem);
    window.addEventListener("storage", onStorage);
    applyToDocument(getState());
    return () => {
      mql?.removeEventListener?.("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setMode = useCallback((mode: ThemeMode) => setModeInternal(mode), []);
  const toggle = useCallback(() => setModeInternal(nextToggleMode(getState().theme)), []);

  return {
    theme: snapshot.theme,
    toggle,
    isDark: snapshot.theme === "dark",
    mode: snapshot.mode,
    setMode,
  };
}
