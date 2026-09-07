import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useLiveOptionChain, useExpiryList } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import { getPositions } from "@/lib/positionStore";
import type { Position } from "@/lib/mockData";
import { SYMBOL_TO_SECURITY_ID, type InstrumentRef } from "@/lib/instrumentKeys";

import { useTerminalConfig } from "./hooks/useTerminalConfig";
import { useArming } from "./hooks/useArming";
import { useLegQuote } from "./hooks/useLegQuote";
import { useQuickOrder } from "./hooks/useQuickOrder";
import { useTerminalActions } from "./hooks/useTerminalActions";
import { useTerminalHotkeys } from "./hooks/useTerminalHotkeys";
import { useRiskStatus } from "./hooks/useRiskStatus";
import { useTradingLock } from "./hooks/useTradingLock";
import { usePanicActions } from "./hooks/usePanicActions";
import { useLegRiskArm } from "./hooks/useLegRiskArm";
import { TerminalHeaderBar } from "./components/TerminalHeaderBar";
import { InstrumentBar } from "./components/InstrumentBar";
import { ExecutionParamsBar } from "./components/ExecutionParamsBar";
import { LegQuoteCard } from "./components/LegQuoteCard";
import { ActionBar } from "./components/ActionBar";
import { MessageLine } from "./components/MessageLine";
import { PositionsGrid } from "./components/PositionsGrid";
import { ArmBanner } from "./components/ArmBanner";
import { RiskEngineStatusBadge } from "./components/RiskEngineStatusBadge";
import { TradingLockBanner } from "./components/TradingLockBanner";
import { KeymapCheatSheet } from "./components/KeymapCheatSheet";
import type { OptionType } from "./types";
import type { TerminalAction as Action } from "./lib/keymap";

const SYMBOLS = ["BANKNIFTY", "NIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];

const INDEX_DISPLAY: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "NIFTY BANK",
  FINNIFTY: "NIFTY FIN SERVICE",
  MIDCPNIFTY: "NIFTY MIDCAP 50",
  SENSEX: "SENSEX",
};

/**
 * 1Cliq Trade — the one-click execution terminal.
 *
 * Phase 1: PAPER execution only. The keyboard layer, arming model, rate limiter
 * and fill model are the real ones — the live adapter is the only piece not
 * wired, so everything a trader learns here transfers exactly.
 *
 * Layout mirrors the reference terminal top to bottom: header, instrument row,
 * execution params, CE/spot/PE strip, action bar, message line, positions grid.
 */
export default function OneCliqTerminal() {
  const { config, update, stepStrike, stepLots, setLotPreset, seedStrikes, setSymbol, lotSize } = useTerminalConfig();
  const { armState, mode, liveEnabled, remainingMs, arm, disarm, keepAlive, focusHandlers } = useArming();
  const [helpOpen, setHelpOpen] = useState(false);
  const [positions, setPositions] = useState<Position[]>(() => getPositions());

  const feedConnected = useWebSocketStatus();
  const { data: expiryData } = useExpiryList(config.symbol);
  const { data: chainData } = useLiveOptionChain(config.symbol, config.expiry || undefined);

  // useExpiryList resolves to { expiries, isLive }; older cached shapes were a
  // bare array, so accept both rather than crashing on a stale query cache.
  const expiries = useMemo(
    () => (Array.isArray(expiryData) ? expiryData : expiryData?.expiries ?? []),
    [expiryData],
  );

  // Default to the nearest expiry once the list arrives.
  useEffect(() => {
    if (!config.expiry && expiries.length > 0) update("expiry", expiries[0].value);
  }, [expiries, config.expiry, update]);

  // Seed both strikes to ATM the first time we learn the spot.
  useEffect(() => {
    if (chainData?.spotPrice) seedStrikes(chainData.spotPrice);
  }, [chainData?.spotPrice, seedStrikes]);

  /** Chain row for a leg, which is where securityId comes from. */
  const legRow = useCallback((optionType: OptionType) => {
    const strike = optionType === "CE" ? config.callStrike : config.putStrike;
    const row = chainData?.chain?.find((r) => r.strikePrice === strike);
    return optionType === "CE" ? row?.ce : row?.pe;
  }, [chainData, config.callStrike, config.putStrike]);

  const securityIdFor = useCallback(
    (optionType: OptionType) => legRow(optionType)?.securityId,
    [legRow],
  );

  /** Live tick subscription per leg — null until the chain resolves an id. */
  const refFor = useCallback((optionType: OptionType): InstrumentRef | null => {
    const securityId = securityIdFor(optionType);
    return securityId ? { exchangeSegment: "NSE_FNO", securityId } : null;
  }, [securityIdFor]);

  const ceRef = useMemo(() => refFor("CE"), [refFor]);
  const peRef = useMemo(() => refFor("PE"), [refFor]);
  const spotRef = useMemo<InstrumentRef | null>(() => {
    const id = SYMBOL_TO_SECURITY_ID[config.symbol];
    return id ? { exchangeSegment: "IDX_I", securityId: id } : null;
  }, [config.symbol]);

  const ceTick = useLegQuote(ceRef);
  const peTick = useLegQuote(peRef);
  const spotTick = useLegQuote(spotRef);

  /**
   * Prefer the streamed tick; fall back to the polled chain so the terminal is
   * usable before the first tick arrives (and after hours). Bid/ask only ever
   * come from the chain — the feed's depth block is not decoded yet.
   */
  const quoteFor = useCallback((optionType: OptionType) => {
    const tick = optionType === "CE" ? ceTick : peTick;
    const row = legRow(optionType);
    return {
      ...tick,
      ltp: tick.ltp ?? (row?.ltp || null),
      bid: row?.bidPrice ?? null,
      ask: row?.askPrice ?? null,
    };
  }, [ceTick, peTick, legRow]);

  const spotQuote = useMemo(() => ({
    ...spotTick,
    ltp: spotTick.ltp ?? (chainData?.spotPrice || null),
  }), [spotTick, chainData?.spotPrice]);

  const refreshPositions = useCallback(() => setPositions(getPositions()), []);

  const { execute, latestMessage, busy, pushMessage, clearMessages } = useQuickOrder({
    config, mode, securityIdFor, quoteFor, onKeepAlive: keepAlive,
  });

  const fire = useCallback(async (optionType: OptionType, side: "BUY" | "SELL") => {
    const fill = await execute(optionType, side);
    if (fill && fill.status !== "REJECTED") refreshPositions();
  }, [execute, refreshPositions]);

  // Server-confirmed status only (1CLIQ-TRADE-SPEC.md §4) — never optimistic.
  const riskStatus = useRiskStatus();
  const tradingLock = useTradingLock();
  const { closeAllLive, cancelAllLive, panicBusy } = usePanicActions({ pushMessage });
  const riskArm = useLegRiskArm();

  const { onAction, exitPercent, closeAll, cancelAll } = useTerminalActions({
    config, expiries, armState, mode, fire, stepStrike, stepLots, setLotPreset, update,
    refreshPositions, pushMessage, arm, disarm, showHelp: () => setHelpOpen(true),
    liveCloseAll: closeAllLive, liveCancelAll: cancelAllLive,
  });

  const { awaitingConfirm } = useTerminalHotkeys(armState, {
    onAction,
    onBlockedWhileSafe: (b) => pushMessage("warning", `"${b.label}" needs one-click armed — press O.`),
    onAwaitingConfirm: (b) => toast.warning(`Press ${b.key} again within 2s to confirm: ${b.label}`),
  });

  const ceStrike = config.callStrike || "—";
  const peStrike = config.putStrike || "—";
  const noSecurityIds = !securityIdFor("CE") && !securityIdFor("PE") && !!chainData;

  return (
    <div className="space-y-2" {...focusHandlers}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          1Cliq Trade
          <Badge variant="outline" className="ml-2 text-xs h-5 align-middle">PAPER</Badge>
        </h1>
        <p className="text-xs text-muted-foreground">
          One-click scalping terminal · fills are simulated at bid/ask with slippage
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <ArmBanner
            armState={armState} mode={mode} liveEnabled={liveEnabled}
            remainingMs={remainingMs} onArm={arm} onDisarm={disarm}
          />
        </div>
        <RiskEngineStatusBadge status={riskStatus} />
      </div>

      <TradingLockBanner
        lock={tradingLock.lock}
        isLossTriggered={tradingLock.isLossTriggered}
        busy={tradingLock.busy}
        unlockError={tradingLock.unlockError}
        onUnlockDirect={tradingLock.unlockDirect}
        onRequestUnlock={tradingLock.requestUnlock}
      />

      <Card className={armState === "HOT" ? "ring-2 ring-bearish/60" : undefined}>
        <CardContent className="p-3 space-y-3">
          <TerminalHeaderBar feedConnected={feedConnected} onShowHelp={() => setHelpOpen(true)} />

          <InstrumentBar
            config={config} symbols={SYMBOLS} expiries={expiries} lotSize={lotSize}
            onSymbol={setSymbol} onUpdate={update} onStepLots={stepLots}
          />

          <ExecutionParamsBar config={config} spot={spotQuote.ltp} onUpdate={update} />

          {noSecurityIds && (
            <p className="text-[11px] text-warning">
              This chain has no broker security IDs (NSE fallback data), so live orders would be impossible.
              Paper fills still work from the polled price.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start pt-1">
            <LegQuoteCard
              title={`${config.symbol} ${ceStrike} CE`}
              quote={quoteFor("CE")}
              onStep={(d) => stepStrike("CE", d)}
              align="left"
            />
            <LegQuoteCard
              title={INDEX_DISPLAY[config.symbol] || config.symbol}
              quote={spotQuote}
              align="center"
              emphasis
            />
            <LegQuoteCard
              title={`${config.symbol} ${peStrike} PE`}
              quote={quoteFor("PE")}
              onStep={(d) => stepStrike("PE", d)}
              align="right"
            />
          </div>

          <ActionBar
            armState={armState}
            busy={busy}
            panicBusy={panicBusy}
            awaitingCloseAllConfirm={awaitingConfirm === "CLOSE_ALL"}
            onBuyCall={() => fire("CE", "BUY")}
            onSellCall={() => fire("CE", "SELL")}
            onBuyPut={() => fire("PE", "BUY")}
            onSellPut={() => fire("PE", "SELL")}
            onCloseAll={closeAll}
            onCancelAll={cancelAll}
            onRefresh={refreshPositions}
          />

          <MessageLine message={latestMessage} onClear={clearMessages} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 px-3 py-2 border-b border-border text-xs">
            <span className="font-medium">Positions</span>
            <Badge variant="outline" className="h-5 text-[10px]">PAPER</Badge>
            <span className="flex-1" />
            <span className="text-muted-foreground">
              MTM:{" "}
              <span className={`font-mono tabular-nums ${positions.reduce((s, p) => s + p.pnl, 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                {positions.reduce((s, p) => s + p.pnl, 0).toLocaleString("en-IN")}
              </span>
            </span>
          </div>
          <div className="overflow-auto">
            <PositionsGrid
              positions={positions}
              onExitPercent={exitPercent}
              riskArm={riskArm}
              activeSymbol={config.symbol}
              activeSpot={spotQuote.ltp}
            />
          </div>
        </CardContent>
      </Card>

      <KeymapCheatSheet open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
