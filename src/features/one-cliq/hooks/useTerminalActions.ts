/**
 * Position-management actions and the keyboard action dispatcher.
 *
 * Split out of OneCliqTerminal so the shell stays a layout component. Every
 * action routes through here regardless of whether it came from a key or a
 * button, so the two can never diverge in behaviour.
 *
 * closeAll/cancelAll below are the PAPER path — local-storage based,
 * unconditional, unchanged from Phase 1. The LIVE path (panic-close-all /
 * panic-cancel-all) is injected as `liveCloseAll`/`liveCancelAll` and is
 * only ever reached when `mode === "LIVE"`; the paper branch never runs in
 * that case and vice versa, so the two cannot cross-contaminate
 * (1CLIQ-TRADE-SPEC.md §5's panic layer owns the live behaviour entirely —
 * see hooks/usePanicActions.ts).
 */

import { useCallback } from "react";
import { getPositions, closePosition } from "@/lib/positionStore";
import type { Position, ExpiryDate } from "@/lib/mockData";
import type { TerminalAction } from "../lib/keymap";
import type { ExecMode, OptionType, TerminalConfig, TerminalMessage } from "../types";

export interface TerminalActionDeps {
  config: TerminalConfig;
  expiries: ExpiryDate[];
  armState: "SAFE" | "HOT";
  mode: ExecMode;
  fire: (optionType: OptionType, side: "BUY" | "SELL") => Promise<void>;
  stepStrike: (leg: OptionType, direction: 1 | -1) => void;
  stepLots: (direction: 1 | -1) => void;
  setLotPreset: (index: number) => void;
  update: <K extends keyof TerminalConfig>(key: K, value: TerminalConfig[K]) => void;
  refreshPositions: () => void;
  pushMessage: (tone: TerminalMessage["tone"], text: string) => void;
  arm: () => void;
  disarm: () => void;
  showHelp: () => void;
  /** LIVE-mode F6/F7 — see hooks/usePanicActions.ts. Absent/no-op in tests that don't need it. */
  liveCloseAll?: () => void;
  liveCancelAll?: () => void;
}

export function useTerminalActions(deps: TerminalActionDeps) {
  const {
    config, expiries, armState, mode, fire, stepStrike, stepLots, setLotPreset,
    update, refreshPositions, pushMessage, arm, disarm, showHelp, liveCloseAll, liveCancelAll,
  } = deps;

  const exitPercent = useCallback((position: Position, pct: 25 | 50 | 75 | 100) => {
    // Lots are indivisible: 25% of 3 lots is 0.75. Rounding up would exit more
    // than the user asked for, so the honest answer is to refuse and say why.
    const exitLots = pct === 100 ? position.lots : Math.floor((position.lots * pct) / 100);
    if (exitLots < 1) {
      pushMessage("warning", `${pct}% of ${position.lots} lots rounds to zero — minimum exit is 1 lot.`);
      return;
    }
    if (exitLots < position.lots) {
      // A true partial needs the position to split into closed and remaining
      // halves, which lands with the live book.
      pushMessage("warning", `Partial exits arrive with the live book — use 100% for now (${exitLots}/${position.lots} lots requested).`);
      return;
    }
    closePosition(position.id, position.currentPrice);
    refreshPositions();
    pushMessage("success", `Closed ${position.symbol} ${position.strike} ${position.type} @ ₹${position.currentPrice.toFixed(2)}`);
  }, [pushMessage, refreshPositions]);

  const closeAll = useCallback(() => {
    if (mode === "LIVE") {
      // Real broker positions — routes through the three-wave panic sweep
      // (spec §5), never this paper logic. liveCloseAll owns its own
      // messaging (it pushes its own success/failure lines).
      if (liveCloseAll) liveCloseAll();
      else pushMessage("error", "Live Close All is not wired in this view.");
      return;
    }

    const open = getPositions();
    if (open.length === 0) {
      pushMessage("info", "No open positions.");
      return;
    }
    // Short options close FIRST. On a live book, closing a long hedge before its
    // short leg re-classifies the spread as naked, spikes SPAN margin, and gets
    // the remaining legs rejected. Paper does not care — but the ordering here
    // must be the one the live path will use, or this rehearses the wrong habit.
    const ordered = [...open].sort((a, b) => Number(b.action === "SELL") - Number(a.action === "SELL"));
    for (const p of ordered) closePosition(p.id, p.currentPrice);
    refreshPositions();
    pushMessage("success", `Closed ${ordered.length} paper position${ordered.length > 1 ? "s" : ""} (shorts first).`);
  }, [mode, liveCloseAll, pushMessage, refreshPositions]);

  const cancelAll = useCallback(() => {
    if (mode === "LIVE") {
      if (liveCancelAll) liveCancelAll();
      else pushMessage("error", "Live Cancel All is not wired in this view.");
      return;
    }
    // Paper fills resolve immediately, so there is never a resting paper order.
    pushMessage("info", "No pending orders — paper fills are immediate.");
  }, [mode, liveCancelAll, pushMessage]);

  const cycleExpiry = useCallback((direction: 1 | -1) => {
    const i = expiries.findIndex((e) => e.value === config.expiry);
    const next = expiries[i + direction];
    if (next) update("expiry", next.value);
    else pushMessage("info", direction > 0 ? "No later expiry available." : "Already on the nearest expiry.");
  }, [expiries, config.expiry, update, pushMessage]);

  const onAction = useCallback((action: TerminalAction) => {
    switch (action) {
      case "BUY_CALL":  void fire("CE", "BUY"); break;
      case "SELL_CALL": void fire("CE", "SELL"); break;
      case "BUY_PUT":   void fire("PE", "BUY"); break;
      case "SELL_PUT":  void fire("PE", "SELL"); break;

      case "CE_STRIKE_UP":   stepStrike("CE", 1); break;
      case "CE_STRIKE_DOWN": stepStrike("CE", -1); break;
      case "PE_STRIKE_UP":   stepStrike("PE", 1); break;
      case "PE_STRIKE_DOWN": stepStrike("PE", -1); break;

      case "LOTS_UP":   stepLots(1); break;
      case "LOTS_DOWN": stepLots(-1); break;
      case "QTY_PRESET_1": setLotPreset(0); break;
      case "QTY_PRESET_2": setLotPreset(1); break;
      case "QTY_PRESET_3": setLotPreset(2); break;
      case "QTY_PRESET_4": setLotPreset(3); break;
      case "QTY_PRESET_5": setLotPreset(4); break;

      case "EXPIRY_NEXT": cycleExpiry(1); break;
      case "EXPIRY_PREV": cycleExpiry(-1); break;

      case "CLOSE_ALL":  closeAll(); break;
      case "CANCEL_ALL": cancelAll(); break;

      case "TOGGLE_ARM": if (armState === "HOT") disarm(); else arm(); break;
      case "DISARM": disarm(); break;
      case "SHOW_HELP": showHelp(); break;

      default:
        // Limit orders, SL placement and partial exits need the live order path.
        // Naming the gap beats a silent no-op that looks like a broken key.
        pushMessage("info", "That shortcut arrives with the live book.");
    }
  }, [fire, stepStrike, stepLots, setLotPreset, cycleExpiry, closeAll, cancelAll, armState, arm, disarm, showHelp, pushMessage]);

  return { onAction, exitPercent, closeAll, cancelAll };
}
