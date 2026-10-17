/**
 * HOT / SAFE arming state for the terminal.
 *
 * Four gates must all hold before a keypress can send a real order:
 *   1. Live Trading on          (persistent, brokerConfig)
 *   2. One-click armed          (session-only, liveArm — never persisted)
 *   3. Terminal focused/hovered (this hook)
 *   4. Explicit arm + confirm   (the caller's dialog)
 *
 * Blur disarms, and there is an idle timeout, because the dangerous state is a
 * terminal left HOT while the user is doing something else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  armOneClick, disarmOneClick, isOneClickArmed, oneClickRemainingMs, touchOneClick,
} from "@/lib/liveArm";
import { isLiveTradingEnabled } from "@/lib/brokerConfig";
import type { ArmState, ExecMode } from "../types";

export function useArming() {
  const [armed, setArmed] = useState(() => isOneClickArmed());
  const [liveEnabled, setLiveEnabled] = useState(() => isLiveTradingEnabled());
  const [remainingMs, setRemainingMs] = useState(() => oneClickRemainingMs());
  const [hasFocus, setHasFocus] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Poll the arming clock so the countdown is visible and an auto-disarm shows
  // up in the UI rather than only being discovered on the next keypress.
  useEffect(() => {
    const id = setInterval(() => {
      const stillArmed = isOneClickArmed();
      setArmed(stillArmed);
      setRemainingMs(oneClickRemainingMs());
      setLiveEnabled(isLiveTradingEnabled());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Leaving the tab disarms. Coming back must NOT re-arm.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && isOneClickArmed()) {
        disarmOneClick();
        setArmed(false);
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onHidden);
    };
  }, []);

  // Disarm on unmount — navigating away must never leave the terminal hot.
  useEffect(() => () => { disarmOneClick(); }, []);

  const arm = useCallback(() => {
    armOneClick();
    setArmed(true);
    setRemainingMs(oneClickRemainingMs());
  }, []);

  const disarm = useCallback(() => {
    disarmOneClick();
    setArmed(false);
    setRemainingMs(0);
  }, []);

  const keepAlive = useCallback(() => {
    if (isOneClickArmed()) {
      touchOneClick();
      setRemainingMs(oneClickRemainingMs());
    }
  }, []);

  /**
   * HOT requires live trading AND arming AND the terminal actually being the
   * thing the user is interacting with. Any one missing means SAFE.
   */
  const armState: ArmState = armed && liveEnabled && hasFocus ? "HOT" : "SAFE";

  /** PAPER is the default and the fallback — never fail open into LIVE. */
  const mode: ExecMode = liveEnabled ? "LIVE" : "PAPER";

  const focusHandlers = {
    onMouseEnter: () => setHasFocus(true),
    onMouseLeave: () => setHasFocus(false),
    onFocusCapture: () => setHasFocus(true),
  };

  return { armState, mode, armed, liveEnabled, remainingMs, arm, disarm, keepAlive, containerRef, focusHandlers };
}
