/**
 * Named dashboard workspaces: several saved layouts (section order, hidden sections, density),
 * four trader presets, and JSON export/import for sharing a set-up. Pure logic with an injectable
 * Storage, so it is unit-tested without a DOM.
 */
import { DASH_LAYOUT_KEY, DEFAULT_LAYOUT, SECTION_IDS, loadLayout, sanitizeLayout, type DashLayout, type Density, type SectionId } from "./dashboardModel";

export const WORKSPACES_KEY = "mc_dash_workspaces_v1";
export const MAX_WORKSPACES = 8;
export const MAX_NAME = 32;
export const EXPORT_KIND = "mr-chartist/dashboard-workspaces";

export type PresetId = "scalper" | "writer" | "swing" | "expiry";

export interface WorkspacePreset {
  id: PresetId;
  name: string;
  description: string;
  layout: DashLayout;
}

export interface Workspace {
  id: string;
  name: string;
  layout: DashLayout;
}

export interface WorkspaceState {
  version: 1;
  activeId: string;
  workspaces: Workspace[];
}

/** Build a preset layout: the listed sections in order, every other section hidden after them. */
function presetLayout(visible: readonly SectionId[], density: Density): DashLayout {
  const rest = SECTION_IDS.filter((id) => !visible.includes(id));
  return { order: [...visible, ...rest], hidden: rest, density };
}

export const PRESETS: readonly WorkspacePreset[] = [
  {
    id: "scalper",
    name: "Scalper",
    description: "Intraday: indices, PCR and max pain, gamma levels, volume leaders and breadth. Compact.",
    layout: presetLayout(["indices", "metrics", "positioning", "active", "movers", "breadth", "brief"], "compact"),
  },
  {
    id: "writer",
    name: "Writer",
    description: "Option sellers: expected move, IV rank, walls and max pain, expiries and the VIX trend.",
    layout: presetLayout(["indices", "brief", "volatility", "ivScanner", "metrics", "positioning", "expiry", "futures"], "comfortable"),
  },
  {
    id: "swing",
    name: "Swing",
    description: "Positional: the daily brief, sectors, breadth, movers, the VIX trend and IV rank.",
    layout: presetLayout(["indices", "brief", "sectors", "breadth", "movers", "futures", "ivScanner", "positioning"], "comfortable"),
  },
  {
    id: "expiry",
    name: "Expiry",
    description: "Expiry day: expiries first, then indices, PCR and max pain, expected move and gamma levels. Compact.",
    layout: presetLayout(["expiry", "indices", "metrics", "volatility", "positioning", "brief", "active"], "compact"),
  },
];

export function presetById(id: string): WorkspacePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

const cloneLayout = (l: DashLayout): DashLayout => ({ order: [...l.order], hidden: [...l.hidden], density: l.density });

export function cleanName(name: unknown, fallback: string): string {
  const s = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  return s || fallback;
}

/** "Writer" → "Writer (2)" when the name is taken (case-insensitive). */
export function uniqueName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name.slice(0, MAX_NAME - 5)} (${i})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  return `${name.slice(0, MAX_NAME - 8)} (${Date.now() % 1000})`;
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `ws-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function defaultWorkspaceState(layout: DashLayout = DEFAULT_LAYOUT): WorkspaceState {
  return { version: 1, activeId: "default", workspaces: [{ id: "default", name: "My dashboard", layout: cloneLayout(sanitizeLayout(layout)) }] };
}

/** Coerce stored or imported JSON into a valid state; null when nothing usable is in it. */
export function sanitizeWorkspaceState(raw: unknown): WorkspaceState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { activeId?: unknown; workspaces?: unknown };
  if (!Array.isArray(r.workspaces)) return null;
  const ids = new Set<string>();
  const names: string[] = [];
  const workspaces: Workspace[] = [];
  for (const w of r.workspaces) {
    if (!w || typeof w !== "object") continue;
    const item = w as { id?: unknown; name?: unknown; layout?: unknown };
    let id = typeof item.id === "string" && /^[\w-]{1,40}$/.test(item.id) ? item.id : newId();
    if (ids.has(id)) id = newId();
    ids.add(id);
    const name = uniqueName(cleanName(item.name, `Workspace ${workspaces.length + 1}`), names);
    names.push(name);
    workspaces.push({ id, name, layout: sanitizeLayout(item.layout) });
    if (workspaces.length >= MAX_WORKSPACES) break;
  }
  if (workspaces.length === 0) return null;
  const activeId = typeof r.activeId === "string" && ids.has(r.activeId) ? r.activeId : workspaces[0].id;
  return { version: 1, activeId, workspaces };
}

function storageOrNull(s?: Storage | null): Storage | null {
  if (s !== undefined) return s;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Read saved workspaces; on first run, adopt the single saved layout from the previous release. Never throws. */
export function loadWorkspaces(storage?: Storage | null): WorkspaceState {
  const s = storageOrNull(storage);
  try {
    const raw = s?.getItem(WORKSPACES_KEY);
    const parsed = raw ? sanitizeWorkspaceState(JSON.parse(raw)) : null;
    if (parsed) return parsed;
  } catch {
    /* corrupt or blocked: fall through */
  }
  let legacy = false;
  try {
    legacy = !!s?.getItem(DASH_LAYOUT_KEY);
  } catch {
    legacy = false;
  }
  return defaultWorkspaceState(legacy ? loadLayout(s) : DEFAULT_LAYOUT);
}

/** Persist workspaces. Returns false when storage is full or blocked. */
export function saveWorkspaces(state: WorkspaceState, storage?: Storage | null): boolean {
  const s = storageOrNull(storage);
  if (!s) return false;
  try {
    s.setItem(WORKSPACES_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function activeWorkspace(state: WorkspaceState): Workspace {
  return state.workspaces.find((w) => w.id === state.activeId) ?? state.workspaces[0];
}

export function updateActiveLayout(state: WorkspaceState, fn: (l: DashLayout) => DashLayout): WorkspaceState {
  const active = activeWorkspace(state);
  const next = fn(active.layout);
  if (next === active.layout) return state;
  return { ...state, workspaces: state.workspaces.map((w) => (w.id === active.id ? { ...w, layout: sanitizeLayout(next) } : w)) };
}

export function switchWorkspace(state: WorkspaceState, id: string): WorkspaceState {
  return state.workspaces.some((w) => w.id === id) && id !== state.activeId ? { ...state, activeId: id } : state;
}

/** Add a workspace (a copy of `layout`) and make it active. Unchanged when the limit is reached. */
export function addWorkspace(state: WorkspaceState, name: string, layout: DashLayout): WorkspaceState {
  if (state.workspaces.length >= MAX_WORKSPACES) return state;
  const id = newId();
  const finalName = uniqueName(cleanName(name, `Workspace ${state.workspaces.length + 1}`), state.workspaces.map((w) => w.name));
  return { ...state, activeId: id, workspaces: [...state.workspaces, { id, name: finalName, layout: cloneLayout(sanitizeLayout(layout)) }] };
}

export function renameWorkspace(state: WorkspaceState, id: string, name: string): WorkspaceState {
  const target = state.workspaces.find((w) => w.id === id);
  if (!target) return state;
  const others = state.workspaces.filter((w) => w.id !== id).map((w) => w.name);
  const finalName = uniqueName(cleanName(name, target.name), others);
  return { ...state, workspaces: state.workspaces.map((w) => (w.id === id ? { ...w, name: finalName } : w)) };
}

/** Delete a workspace. The last one cannot be deleted. */
export function deleteWorkspace(state: WorkspaceState, id: string): WorkspaceState {
  if (state.workspaces.length <= 1 || !state.workspaces.some((w) => w.id === id)) return state;
  const workspaces = state.workspaces.filter((w) => w.id !== id);
  return { ...state, workspaces, activeId: state.activeId === id ? workspaces[0].id : state.activeId };
}

/** Replace the active workspace's layout with a preset's. */
export function applyPreset(state: WorkspaceState, presetId: PresetId): WorkspaceState {
  const p = presetById(presetId);
  return p ? updateActiveLayout(state, () => cloneLayout(p.layout)) : state;
}

/** Which preset (if any) a layout matches exactly. */
export function matchingPreset(layout: DashLayout): PresetId | null {
  const key = (l: DashLayout) => `${l.order.join(",")}|${[...l.hidden].sort().join(",")}|${l.density}`;
  const k = key(layout);
  return PRESETS.find((p) => key(p.layout) === k)?.id ?? null;
}

// ───────────────────────── Export / import ─────────────────────────

export interface WorkspaceExport {
  kind: typeof EXPORT_KIND;
  version: 1;
  exportedAt: string;
  workspaces: Array<Pick<Workspace, "name" | "layout">>;
}

/** Pretty JSON for a download or the clipboard. Only names and layouts are exported. */
export function exportWorkspaces(state: WorkspaceState, only?: string, now: Date = new Date()): string {
  const list = only ? state.workspaces.filter((w) => w.id === only) : state.workspaces;
  const payload: WorkspaceExport = { kind: EXPORT_KIND, version: 1, exportedAt: now.toISOString(), workspaces: list.map((w) => ({ name: w.name, layout: cloneLayout(w.layout) })) };
  return JSON.stringify(payload, null, 2);
}

export type ImportResult = { ok: true; state: WorkspaceState; added: string[]; skipped: number } | { ok: false; error: string };

/**
 * Merge workspaces from JSON text into `state`. Accepts a full export, a single workspace
 * ({name, layout}) or a bare layout ({order, hidden, density}). Imported names that clash get a
 * numeric suffix. The first imported workspace becomes active.
 */
export function importWorkspaces(state: WorkspaceState, text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON. Paste the text exported from this dashboard." };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "The JSON does not contain a dashboard workspace." };
  const r = raw as Record<string, unknown>;
  let items: unknown[];
  if (Array.isArray(r.workspaces)) items = r.workspaces;
  else if (r.layout && typeof r.layout === "object") items = [r];
  else if (Array.isArray(r.order)) items = [{ name: "Imported", layout: r }];
  else return { ok: false, error: "The JSON does not contain a dashboard workspace." };

  const room = MAX_WORKSPACES - state.workspaces.length;
  if (room <= 0) return { ok: false, error: `You already have ${MAX_WORKSPACES} workspaces. Delete one before importing.` };

  const valid = items.filter((it): it is Record<string, unknown> => !!it && typeof it === "object" && !!(it as Record<string, unknown>).layout && typeof (it as Record<string, unknown>).layout === "object");
  if (valid.length === 0) return { ok: false, error: "No usable workspace layouts were found in the JSON." };

  const names = state.workspaces.map((w) => w.name);
  const added: Workspace[] = [];
  for (const it of valid.slice(0, room)) {
    const name = uniqueName(cleanName(it.name, "Imported"), names);
    names.push(name);
    added.push({ id: newId(), name, layout: sanitizeLayout(it.layout) });
  }
  return {
    ok: true,
    state: { ...state, activeId: added[0].id, workspaces: [...state.workspaces, ...added] },
    added: added.map((w) => w.name),
    skipped: items.length - added.length,
  };
}
