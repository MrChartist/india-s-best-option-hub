/**
 * The keyboard layer.
 *
 * Registered on the CAPTURE phase so it runs before the app's global
 * bubble-phase shortcut hook (useKeyboardShortcuts). When a terminal binding
 * matches we stopPropagation, so global nav never double-fires; when it does
 * not, the event flows on untouched and Ctrl+1..8 / "/" / Alt+A keep working.
 *
 * Safety properties this hook is responsible for:
 *   - never fires while the user is typing or a modal is open
 *   - never fires an EXECUTING binding unless the terminal is HOT
 *   - rejects OS key-repeat, so a held arrow key sends exactly one order
 *   - requires a second press within CONFIRM_WINDOW_MS for double-tap bindings
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveBinding, CONFIRM_WINDOW_MS, type KeyBinding, type TerminalAction } from "../lib/keymap";
import { isTypingTarget } from "../lib/isTypingTarget";
import type { ArmState } from "../types";

export interface HotkeyHandlers {
  onAction: (action: TerminalAction, binding: KeyBinding) => void;
  /** Called when an executing key is pressed while SAFE, so the UI can explain. */
  onBlockedWhileSafe?: (binding: KeyBinding) => void;
  /** Called on the FIRST press of a double-tap binding. */
  onAwaitingConfirm?: (binding: KeyBinding) => void;
}

export function useTerminalHotkeys(armState: ArmState, handlers: HotkeyHandlers, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const armStateRef = useRef(armState);
  armStateRef.current = armState;

  /** action → timestamp of the first press, for double-tap confirmation. */
  const pendingRef = useRef(new Map<TerminalAction, number>());
  const [awaiting, setAwaiting] = useState<TerminalAction | null>(null);

  const clearPending = useCallback((action: TerminalAction) => {
    pendingRef.current.delete(action);
    setAwaiting((cur) => (cur === action ? null : cur));
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      // OS key-repeat. Rejecting this is what stops a held arrow key from
      // machine-gunning orders; the rate limiter is the backstop, not the fix.
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;

      const binding = resolveBinding(e);
      if (!binding) return;

      // Claim the event before the global bubble-phase handler sees it.
      e.preventDefault();
      e.stopPropagation();

      if (binding.executes && armStateRef.current !== "HOT") {
        handlersRef.current.onBlockedWhileSafe?.(binding);
        return;
      }

      if (binding.doubleTap) {
        const now = Date.now();
        const firstPress = pendingRef.current.get(binding.action);
        if (firstPress && now - firstPress <= CONFIRM_WINDOW_MS) {
          clearPending(binding.action);
          handlersRef.current.onAction(binding.action, binding);
          return;
        }
        pendingRef.current.set(binding.action, now);
        setAwaiting(binding.action);
        handlersRef.current.onAwaitingConfirm?.(binding);
        // Expire the confirmation window so a press now and another in five
        // minutes never combine into a square-off.
        setTimeout(() => {
          const t = pendingRef.current.get(binding.action);
          if (t && Date.now() - t >= CONFIRM_WINDOW_MS) clearPending(binding.action);
        }, CONFIRM_WINDOW_MS + 50);
        return;
      }

      handlersRef.current.onAction(binding.action, binding);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled, clearPending]);

  // Any disarm cancels a half-completed confirmation.
  useEffect(() => {
    if (armState !== "HOT") {
      pendingRef.current.clear();
      setAwaiting(null);
    }
  }, [armState]);

  return { awaitingConfirm: awaiting };
}
