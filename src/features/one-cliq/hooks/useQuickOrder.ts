/**
 * The execution path: one function that a keypress, a button, or a future live
 * adapter all travel through.
 *
 * Paper and live differ ONLY at the last hop. Everything before it — intent
 * construction, the rate limiter, the arming gate, the message log — is shared,
 * so paper genuinely exercises the code that will later move real money instead
 * of being a separate happy path that drifts out of sync.
 *
 * Phase 1 ships the paper adapter only. The live branch is deliberately left as
 * an explicit, visible refusal rather than a silent fallthrough.
 */

import { useCallback, useRef, useState } from "react";
import { createPosition, addPosition } from "@/lib/positionStore";
import { createRateLimiter, rateLimitMessage, isDenied } from "../lib/rateLimiter";
import { simulateFill } from "../lib/fillModel";
import type {
  ExecMode, FillResult, LegQuote, OptionType, OrderIntent, Side, TerminalConfig, TerminalMessage,
} from "../types";

const MAX_MESSAGES = 50;

let intentCounter = 0;
function newIntentId(): string {
  intentCounter += 1;
  return `i${Date.now().toString(36)}-${intentCounter}`;
}

export interface QuickOrderDeps {
  config: TerminalConfig;
  mode: ExecMode;
  /** Resolved securityId for a leg, when the chain has provided one. */
  securityIdFor: (optionType: OptionType) => string | undefined;
  quoteFor: (optionType: OptionType) => LegQuote;
  onKeepAlive?: () => void;
}

export function useQuickOrder({ config, mode, securityIdFor, quoteFor, onKeepAlive }: QuickOrderDeps) {
  const [messages, setMessages] = useState<TerminalMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const limiterRef = useRef(createRateLimiter());
  /** Guards against a double-click resolving twice while a fill is in flight. */
  const inFlightRef = useRef(false);

  const pushMessage = useCallback((tone: TerminalMessage["tone"], text: string) => {
    setMessages((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), tone, text },
      ...prev,
    ].slice(0, MAX_MESSAGES));
  }, []);

  const buildIntent = useCallback((optionType: OptionType, side: Side): OrderIntent | { error: string } => {
    const strike = optionType === "CE" ? config.callStrike : config.putStrike;
    if (!strike) return { error: `No ${optionType} strike selected.` };

    const quote = quoteFor(optionType);
    if (quote.ltp === null || quote.ltp <= 0) {
      // Never invent a price. Without a live quote there is no honest fill.
      return { error: `No live price for ${config.symbol} ${strike} ${optionType} yet.` };
    }

    return {
      intentId: newIntentId(),
      symbol: config.symbol,
      optionType,
      strike,
      side,
      lots: config.lots,
      securityId: securityIdFor(optionType),
      exchangeSegment: "NSE_FNO",
      variant: config.orderVariant,
      refPrice: quote.ltp,
      bid: quote.bid ?? null,
      ask: quote.ask ?? null,
      expiry: config.expiry,
    };
  }, [config, quoteFor, securityIdFor]);

  const execute = useCallback(async (optionType: OptionType, side: Side): Promise<FillResult | null> => {
    if (inFlightRef.current) return null;

    const verdict = limiterRef.current.tryConsume();
    if (isDenied(verdict)) {
      pushMessage("error", rateLimitMessage(verdict));
      return null;
    }

    const intent = buildIntent(optionType, side);
    if ("error" in intent) {
      pushMessage("error", intent.error);
      return null;
    }

    inFlightRef.current = true;
    setBusy(true);
    onKeepAlive?.();

    try {
      if (mode === "LIVE") {
        // Phase 1 is paper-only by design. Saying so plainly beats quietly
        // routing a live keypress into a paper fill, which would be a lie about
        // whether real money moved.
        pushMessage(
          "warning",
          "Live one-click execution is not enabled in this build — the order was NOT sent. Use the option chain's confirmed order flow for live trades.",
        );
        return null;
      }

      const fill = simulateFill(intent, {
        bid: intent.bid,
        ask: intent.ask,
      });

      if (fill.status === "REJECTED") {
        pushMessage("error", `Rejected: ${fill.reason || "no reason given"}`);
        return fill;
      }

      // Simulated latency happens AFTER the price is decided, so the fill price
      // reflects the moment of the keypress, as a real exchange fill would.
      await new Promise((r) => setTimeout(r, fill.latencyMs));

      addPosition(createPosition({
        symbol: intent.symbol,
        type: intent.optionType,
        action: intent.side,
        strike: intent.strike,
        entryPrice: fill.price,
        lots: fill.lots,
        expiry: intent.expiry,
      }));

      const slipNote = fill.slippage !== 0
        ? ` (${fill.slippage > 0 ? "+" : ""}${fill.slippage.toFixed(2)} vs LTP)`
        : "";
      const partialNote = fill.status === "PARTIAL" ? ` — PARTIAL, ${fill.reason}` : "";
      pushMessage(
        fill.status === "PARTIAL" ? "warning" : "success",
        `PAPER ${intent.side} ${fill.lots}× ${intent.symbol} ${intent.strike} ${intent.optionType} @ ₹${fill.price.toFixed(2)}${slipNote}${partialNote}`,
      );
      return fill;
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [buildIntent, mode, onKeepAlive, pushMessage]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { execute, messages, latestMessage: messages[0] ?? null, busy, pushMessage, clearMessages };
}
