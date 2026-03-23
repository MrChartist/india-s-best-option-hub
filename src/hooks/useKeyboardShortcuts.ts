import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface ShortcutAction {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  description: string;
  category: string;
  action: () => void;
}

export function useKeyboardShortcuts({
  onToggleGreeks,
  onToggleSearch,
  onToggleAlerts,
}: {
  onToggleGreeks?: () => void;
  onToggleSearch?: () => void;
  onToggleAlerts?: () => void;
} = {}) {
  const navigate = useNavigate();

  const shortcuts: ShortcutAction[] = [
    { key: "/", description: "Open search / command palette", category: "Navigation", action: () => onToggleSearch?.() },
    { key: "1", ctrl: true, description: "Dashboard", category: "Navigation", action: () => navigate("/") },
    { key: "2", ctrl: true, description: "Option Chain", category: "Navigation", action: () => navigate("/option-chain") },
    { key: "3", ctrl: true, description: "OI Analysis", category: "Navigation", action: () => navigate("/oi-analysis") },
    { key: "4", ctrl: true, description: "Greeks Calculator", category: "Navigation", action: () => navigate("/greeks") },
    { key: "5", ctrl: true, description: "Strategy Builder", category: "Navigation", action: () => navigate("/strategy") },
    { key: "g", description: "Toggle Greeks", category: "Option Chain", action: () => onToggleGreeks?.() },
    { key: "a", alt: true, description: "Open Alerts", category: "Tools", action: () => onToggleAlerts?.() },
    { key: "Escape", description: "Close panels", category: "General", action: () => {} },
  ];

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger in inputs
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    for (const s of shortcuts) {
      const ctrlMatch = s.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
      const altMatch = s.alt ? e.altKey : !e.altKey;
      const shiftMatch = s.shift ? e.shiftKey : true;
      
      if (e.key === s.key && ctrlMatch && altMatch && shiftMatch) {
        e.preventDefault();
        s.action();
        return;
      }
    }
  }, [shortcuts]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return shortcuts;
}
