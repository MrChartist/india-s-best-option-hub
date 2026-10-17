import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES, routeForShortcut } from "@/lib/routes";

export interface ShortcutAction {
  /** Display form of the keys, e.g. "g c", "/", "Shift+G", "Alt+A". */
  keys: string;
  /** KeyboardEvent.key of the (final) key. */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  /** Second key of a "g then letter" sequence. */
  sequence?: boolean;
  description: string;
  category: ShortcutCategory;
  action: () => void;
}

export type ShortcutCategory = "Navigation" | "General" | "Option Chain" | "Tools";

/** How long after pressing "g" the second key is accepted. */
export const SEQUENCE_TIMEOUT_MS = 1200;

export interface ShortcutHelpItem {
  keys: string[];
  description: string;
}

export interface ShortcutHelpGroup {
  category: ShortcutCategory;
  items: ShortcutHelpItem[];
}

/**
 * Data for the "?" shortcut overlay. Static so the overlay can render without
 * the hook (the integrator owns the overlay UI).
 */
export const SHORTCUT_HELP: ShortcutHelpGroup[] = [
  {
    category: "Navigation",
    items: ROUTES.filter((r) => r.shortcut && !r.hidden).map((r) => ({
      keys: (r.shortcut as string).split(" "),
      description: `Go to ${r.navLabel}`,
    })),
  },
  {
    category: "General",
    items: [
      { keys: ["/"], description: "Open search / command palette" },
      { keys: ["Ctrl", "K"], description: "Open command palette" },
      { keys: ["R"], description: "Refresh market data" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
      { keys: ["Esc"], description: "Close panels and dialogs" },
    ],
  },
  {
    category: "Tools",
    items: [
      { keys: ["Alt", "A"], description: "Open alerts" },
      { keys: ["Shift", "G"], description: "Toggle Greeks columns (Option Chain)" },
    ],
  },
];

/** True when the event comes from somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return role === "textbox" || role === "combobox" || role === "searchbox";
}

/** True while a Radix dialog, sheet, alert dialog or menu is open. */
export function isOverlayOpen(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  return Boolean(
    doc.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
    ),
  );
}

/**
 * Global keyboard shortcuts:
 * - "g" then a letter jumps to a page (from the ROUTES registry: g d, g c, g o, g s, g v, g x, g f, g p, g l)
 * - "/" opens search, "?" opens the shortcut overlay, Alt+A opens alerts, Shift+G toggles Greeks
 *
 * Ignored while typing in inputs/contentEditable or while a dialog is open.
 * Returns the active shortcut list (for help overlays).
 */
export function useKeyboardShortcuts({
  onToggleGreeks,
  onToggleSearch,
  onToggleAlerts,
  onShowShortcuts,
}: {
  onToggleGreeks?: () => void;
  onToggleSearch?: () => void;
  onToggleAlerts?: () => void;
  onShowShortcuts?: () => void;
} = {}): ShortcutAction[] {
  const navigate = useNavigate();
  const pendingG = useRef<number | null>(null);

  const shortcuts: ShortcutAction[] = useMemo(() => {
    const nav: ShortcutAction[] = ROUTES.filter((r) => r.shortcut && !r.hidden).map((r) => {
      const second = (r.shortcut as string).split(" ")[1] ?? "";
      return {
        keys: r.shortcut as string,
        key: second,
        sequence: true,
        description: `Go to ${r.navLabel}`,
        category: "Navigation" as const,
        action: () => navigate(r.path),
      };
    });
    const list: ShortcutAction[] = [
      ...nav,
      { keys: "/", key: "/", description: "Open search / command palette", category: "General", action: () => onToggleSearch?.() },
      { keys: "Ctrl+K", key: "k", ctrl: true, description: "Open command palette", category: "General", action: () => onToggleSearch?.() },
      { keys: "?", key: "?", shift: true, description: "Show keyboard shortcuts", category: "General", action: () => onShowShortcuts?.() },
      { keys: "Alt+A", key: "a", alt: true, description: "Open alerts", category: "Tools", action: () => onToggleAlerts?.() },
      { keys: "Shift+G", key: "G", shift: true, description: "Toggle Greeks", category: "Option Chain", action: () => onToggleGreeks?.() },
    ];
    return list;
  }, [navigate, onToggleSearch, onToggleGreeks, onToggleAlerts, onShowShortcuts]);

  // Keep the latest list in a ref so the listener is attached once.
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (isTypingTarget(e.target) || isOverlayOpen()) {
        pendingG.current = null;
        return;
      }
      const mod = e.ctrlKey || e.metaKey;

      // Second key of a "g" sequence.
      if (pendingG.current !== null) {
        const fresh = Date.now() - pendingG.current <= SEQUENCE_TIMEOUT_MS;
        pendingG.current = null;
        if (fresh && !mod && !e.altKey) {
          const route = routeForShortcut(e.key);
          if (route) {
            e.preventDefault();
            navigateRef.current(route.path);
            return;
          }
        }
      }

      if (e.key === "g" && !mod && !e.altKey && !e.shiftKey) {
        pendingG.current = Date.now();
        return;
      }

      // e.code handles layouts where Alt+A produces a different character (macOS: "å").
      const altA = e.altKey && !mod && (e.key.toLowerCase() === "a" || e.code === "KeyA");
      for (const s of shortcutsRef.current) {
        if (s.sequence) continue;
        if (s.alt) {
          if (!altA) continue;
        } else if (s.ctrl) {
          if (!mod || e.altKey || e.key.toLowerCase() !== s.key) continue;
        } else if (mod || e.altKey || e.key !== s.key) {
          continue;
        }
        e.preventDefault();
        s.action();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return shortcuts;
}
