import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_ALL } from "@/lib/navigation";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global shortcuts:
 *   ⌘K / Ctrl+K or "/"  search      A  alerts      R  refresh (handled in layout)
 *   1–7                 jump to page (see lib/navigation.ts)
 * Bare-key shortcuts are ignored while typing in a field.
 */
export function useKeyboardShortcuts({
  onToggleSearch,
  onToggleAlerts,
}: {
  onToggleSearch?: () => void;
  onToggleAlerts?: () => void;
} = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K works everywhere, even inside inputs
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onToggleSearch?.();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;

      if (e.key === "/") {
        e.preventDefault();
        onToggleSearch?.();
        return;
      }
      if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        onToggleAlerts?.();
        return;
      }
      const nav = NAV_ALL.find((n) => n.key === e.key);
      if (nav) {
        e.preventDefault();
        navigate(nav.url);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, onToggleSearch, onToggleAlerts]);
}
