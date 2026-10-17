/**
 * Follow-up rules for basket legs — "if leg A fills, enter leg B" — the gap
 * the spec calls out that 1Cliq has no answer for (section 9).
 *
 * evaluateRules() is a pure event -> action translator with no side effects;
 * whatever wires the real order engine decides what an action means. Keeping
 * it pure is what lets it run byte-identically in paper and live (spec
 * section 7's "one execution path" rule) and be tested without a broker.
 *
 * validateRulesNoCycles() runs at SAVE time, not deploy time, because a rule
 * set that can retrigger its own `when` is an infinite order generator — the
 * kind of bug that would otherwise only surface live, mid-basket, as a runaway
 * loop of real orders. Rejecting it before it can ever be deployed is the
 * whole point.
 */

/**
 * @typedef {Object} LegRule
 * @property {{leg:string, event:"FILLED"|"REJECTED"|"SL_HIT"|"TARGET_HIT"}} when
 * @property {{action:"ENTER"|"EXIT"|"CANCEL"|"HALT_BASKET", target:string}} then
 *   target is a legId, or the literal string "ALL_REMAINING"
 * @typedef {Object} LegEvent
 * @property {string} leg
 * @property {"FILLED"|"REJECTED"|"SL_HIT"|"TARGET_HIT"} event
 * @typedef {Object} Action
 * @property {"ENTER"|"EXIT"|"CANCEL"|"HALT_BASKET"} action
 * @property {string} target
 * @property {string} causeLeg
 * @property {string} causeEvent
 */

/**
 * Translate a sequence of leg events into the actions the rule set implies.
 * Pure: same (rules, events) always yields the same Action[], in event order
 * then rule-definition order — no clock, no network, no mutation.
 * @param {LegRule[]} rules
 * @param {LegEvent[]} events
 * @returns {Action[]}
 */
export function evaluateRules(rules, events) {
  if (!Array.isArray(rules) || !Array.isArray(events)) return [];
  const actions = [];
  for (const event of events) {
    for (const rule of rules) {
      if (rule?.when?.leg === event?.leg && rule?.when?.event === event?.event) {
        actions.push({
          action: rule.then.action,
          target: rule.then.target,
          causeLeg: event.leg,
          causeEvent: event.event,
        });
      }
    }
  }
  return actions;
}

// Only ENTER/EXIT place a new order that can itself later fire an event a
// `when` clause listens for. CANCEL and HALT_BASKET stop something rather
// than start it, so they cannot be a link in a regenerating cycle.
const EDGE_ACTIONS = new Set(["ENTER", "EXIT"]);

function collectLegIds(rules) {
  const legIds = new Set();
  for (const r of rules) {
    if (r?.when?.leg) legIds.add(r.when.leg);
    if (r?.then?.target && r.then.target !== "ALL_REMAINING") legIds.add(r.then.target);
  }
  return legIds;
}

function buildAdjacency(rules, legIds) {
  const adjacency = new Map([...legIds].map((leg) => [leg, new Set()]));
  for (const rule of rules) {
    const from = rule?.when?.leg;
    const action = rule?.then?.action;
    const target = rule?.then?.target;
    if (!from || !adjacency.has(from) || !EDGE_ACTIONS.has(action) || !target) continue;
    if (target === "ALL_REMAINING") {
      for (const leg of legIds) if (leg !== from) adjacency.get(from).add(leg);
    } else if (adjacency.has(target)) {
      adjacency.get(from).add(target);
    }
  }
  return adjacency;
}

/** DFS with recursion-stack coloring; returns the cycle (leg ids, closing the
 * loop) starting at `start`, or null if that component has none. */
function findCycleFrom(start, adjacency, color) {
  color.set(start, "GRAY");
  const path = [start];

  function visit(node) {
    for (const next of adjacency.get(node) || []) {
      if (color.get(next) === "GRAY") return [...path.slice(path.indexOf(next)), next];
      if (color.get(next) === "WHITE") {
        color.set(next, "GRAY");
        path.push(next);
        const found = visit(next);
        if (found) return found;
        path.pop();
        color.set(next, "BLACK");
      }
    }
    return null;
  }

  const result = visit(start);
  if (!result) color.set(start, "BLACK");
  return result;
}

/**
 * Reject any rule set where a leg's own fill can, through some chain of
 * ENTER/EXIT rules, eventually re-trigger a rule watching that same leg — a
 * self-loop is just the length-1 case (e.g. "leg L1 FILLED -> ENTER L1").
 * @param {LegRule[]} rules
 * @returns {{ok:boolean, reason?:string, cycle?:string[]}}
 */
export function validateRulesNoCycles(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return { ok: true };

  const legIds = collectLegIds(rules);
  const adjacency = buildAdjacency(rules, legIds);
  const color = new Map([...legIds].map((leg) => [leg, "WHITE"]));

  for (const leg of legIds) {
    if (color.get(leg) !== "WHITE") continue;
    const cycle = findCycleFrom(leg, adjacency, color);
    if (cycle) {
      return {
        ok: false,
        reason: `Rule cycle detected: ${cycle.join(" -> ")} — this would regenerate orders forever.`,
        cycle,
      };
    }
  }
  return { ok: true };
}
