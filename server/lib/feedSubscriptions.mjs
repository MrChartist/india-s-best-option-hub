/**
 * Refcounted Dhan feed subscription manager.
 *
 * Before this, the proxy subscribed to five hardcoded indices and nothing else —
 * every option price in the app came from a REST poll roughly 3-10 seconds stale.
 * A scalping terminal cannot run on that, and neither can a spot-referenced stop
 * loss. A dynamic-subscribe handler existed in proxy-server.mjs but nothing ever
 * sent to it, and it had no bookkeeping.
 *
 * What this adds:
 *  - Refcounting, so two components watching the same strike share one
 *    subscription and the last one to leave releases it.
 *  - A LINGER delay before unsubscribing. Arrow-key strike stepping re-enters
 *    the same instrument constantly; unsubscribing instantly would thrash the
 *    socket and lose the first ticks after every step.
 *  - Microbatching, so stepping through six strikes sends one message.
 *  - A desired-set replayed on reconnect, so a dropped socket comes back with
 *    everything the user is actually watching — not just the boot list.
 */

import { tickKey } from "./dhanPacketParser.mjs";

const SUBSCRIBE = 21;   // Dhan RequestCode: subscribe, full packet mode
const UNSUBSCRIBE = 22; // Dhan RequestCode: unsubscribe

const BATCH_DELAY_MS = 50;
const LINGER_MS = 10000;
// Dhan documents a per-message instrument cap. Chunk conservatively.
// NEEDS VERIFICATION against current Dhan v2 docs before raising.
const MAX_PER_MESSAGE = 100;
// Hard local ceiling. If we hit it we tell the user rather than silently
// dropping instruments and showing them a frozen price.
const MAX_TOTAL_INSTRUMENTS = 1000;

export function createSubscriptionManager({ send, isOpen, onCapacityExceeded } = {}) {
  /** key -> { exchangeSegment, securityId, refs } */
  const desired = new Map();
  /** key -> timeout handle */
  const lingering = new Map();

  const pendingSubscribe = new Set();
  const pendingUnsubscribe = new Set();
  let flushTimer = null;

  function instrumentOf(key) {
    const entry = desired.get(key);
    if (!entry) return null;
    return { ExchangeSegment: entry.exchangeSegment, SecurityId: String(entry.securityId) };
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function flush() {
    flushTimer = null;
    if (!isOpen?.()) {
      // Socket is down. Keep the desired set; replayAll() will resend on open.
      pendingSubscribe.clear();
      pendingUnsubscribe.clear();
      return;
    }

    const subs = [...pendingSubscribe].map(instrumentOf).filter(Boolean);
    pendingSubscribe.clear();
    for (const group of chunk(subs, MAX_PER_MESSAGE)) {
      send({ RequestCode: SUBSCRIBE, InstrumentCount: group.length, InstrumentList: group });
    }

    // Unsubscribes carry their own instrument payload because by this point the
    // entry is already gone from `desired`.
    const unsubs = [...pendingUnsubscribe];
    pendingUnsubscribe.clear();
    for (const group of chunk(unsubs, MAX_PER_MESSAGE)) {
      send({ RequestCode: UNSUBSCRIBE, InstrumentCount: group.length, InstrumentList: group });
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, BATCH_DELAY_MS);
  }

  /** Take a reference on an instrument, subscribing if it is the first. */
  function acquire(exchangeSegment, securityId) {
    const key = tickKey(exchangeSegment, securityId);

    // Cancel a pending unsubscribe — the user came straight back to this strike.
    const linger = lingering.get(key);
    if (linger) {
      clearTimeout(linger);
      lingering.delete(key);
    }

    const existing = desired.get(key);
    if (existing) {
      existing.refs++;
      return key;
    }

    if (desired.size >= MAX_TOTAL_INSTRUMENTS) {
      onCapacityExceeded?.(desired.size, key);
      return null;
    }

    desired.set(key, { exchangeSegment, securityId: String(securityId), refs: 1 });
    pendingUnsubscribe.delete(key);
    pendingSubscribe.add(key);
    scheduleFlush();
    return key;
  }

  /** Release a reference. The actual unsubscribe waits out the linger window. */
  function release(exchangeSegment, securityId) {
    const key = tickKey(exchangeSegment, securityId);
    const entry = desired.get(key);
    if (!entry) return;

    entry.refs--;
    if (entry.refs > 0) return;

    const payload = { ExchangeSegment: entry.exchangeSegment, SecurityId: entry.securityId };
    const timer = setTimeout(() => {
      lingering.delete(key);
      const current = desired.get(key);
      if (!current || current.refs > 0) return; // re-acquired during the linger
      desired.delete(key);
      pendingSubscribe.delete(key);
      pendingUnsubscribe.add(payload);
      scheduleFlush();
    }, LINGER_MS);

    lingering.set(key, timer);
  }

  /** Permanent instruments (the index set) that are never released. */
  function pin(instruments) {
    for (const inst of instruments) {
      acquire(inst.ExchangeSegment, inst.SecurityId);
      // A second reference that nothing ever releases keeps these alive even if
      // a UI subscriber acquires and releases the same index.
      const entry = desired.get(tickKey(inst.ExchangeSegment, inst.SecurityId));
      if (entry) entry.refs++;
    }
  }

  /** Resend the entire desired set — call on every reconnect, not just boot. */
  function replayAll() {
    if (!isOpen?.()) return 0;
    const all = [...desired.values()].map((e) => ({
      ExchangeSegment: e.exchangeSegment,
      SecurityId: String(e.securityId),
    }));
    for (const group of chunk(all, MAX_PER_MESSAGE)) {
      send({ RequestCode: SUBSCRIBE, InstrumentCount: group.length, InstrumentList: group });
    }
    return all.length;
  }

  function stats() {
    return { subscribed: desired.size, lingering: lingering.size, capacity: MAX_TOTAL_INSTRUMENTS };
  }

  function dispose() {
    if (flushTimer) clearTimeout(flushTimer);
    for (const t of lingering.values()) clearTimeout(t);
    lingering.clear();
    desired.clear();
  }

  return { acquire, release, pin, replayAll, stats, dispose };
}
