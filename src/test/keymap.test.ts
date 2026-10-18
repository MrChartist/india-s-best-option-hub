import { describe, it, expect } from "vitest";
import { KEYMAP, resolveBinding, chordLabel } from "@/features/one-cliq/lib/keymap";

function key(k: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) {
  return {
    key: k,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
  } as KeyboardEvent;
}

describe("the execution keys", () => {
  it("maps the four arrows to the four order actions", () => {
    expect(resolveBinding(key("ArrowUp"))?.action).toBe("BUY_CALL");
    expect(resolveBinding(key("ArrowDown"))?.action).toBe("SELL_CALL");
    expect(resolveBinding(key("ArrowRight"))?.action).toBe("BUY_PUT");
    expect(resolveBinding(key("ArrowLeft"))?.action).toBe("SELL_PUT");
  });

  it("marks every order-placing binding as executing, so the HOT gate applies", () => {
    for (const action of ["BUY_CALL", "SELL_CALL", "BUY_PUT", "SELL_PUT"]) {
      expect(KEYMAP.find((b) => b.action === action)?.executes).toBe(true);
    }
  });

  it("does NOT mark strike/lot selection as executing — those must always work", () => {
    for (const action of ["CE_STRIKE_UP", "PE_STRIKE_DOWN", "LOTS_UP", "QTY_PRESET_1"]) {
      expect(KEYMAP.find((b) => b.action === action)?.executes).toBeFalsy();
    }
  });
});

describe("modifiers are matched strictly", () => {
  it("separates a bare arrow from a shifted arrow", () => {
    expect(resolveBinding(key("ArrowUp"))?.action).toBe("BUY_CALL");
    expect(resolveBinding(key("ArrowUp", { shift: true }))?.action).toBe("CE_STRIKE_UP");
  });

  it("does not fire a bare binding when Ctrl is held — global nav keeps Ctrl+digits", () => {
    expect(resolveBinding(key("1"))?.action).toBe("QTY_PRESET_1");
    expect(resolveBinding(key("1", { ctrl: true }))).toBeNull();
    expect(resolveBinding(key("1", { meta: true }))).toBeNull();
  });

  it("separates bare digits from Alt+digits", () => {
    expect(resolveBinding(key("1"))?.action).toBe("QTY_PRESET_1");
    expect(resolveBinding(key("1", { alt: true }))?.action).toBe("EXIT_25");
  });

  it("separates E from Shift+E", () => {
    expect(resolveBinding(key("e"))?.action).toBe("EXPIRY_NEXT");
    expect(resolveBinding(key("E", { shift: true }))?.action).toBe("EXPIRY_PREV");
  });

  it("matches letters case-insensitively, so Caps Lock does not break the terminal", () => {
    expect(resolveBinding(key("O"))?.action).toBe("TOGGLE_ARM");
    expect(resolveBinding(key("o"))?.action).toBe("TOGGLE_ARM");
  });
});

describe("safety bindings", () => {
  it("requires a double tap to close everything", () => {
    const closeAll = KEYMAP.find((b) => b.action === "CLOSE_ALL");
    expect(closeAll?.key).toBe("F6");
    expect(closeAll?.doubleTap).toBe(true);
  });

  it("lets cancel-all fire on a single press — cancelling is the safe direction", () => {
    const cancelAll = KEYMAP.find((b) => b.action === "CANCEL_ALL");
    expect(cancelAll?.key).toBe("F7");
    expect(cancelAll?.doubleTap).toBeFalsy();
  });

  it("requires a double tap for a full position exit", () => {
    expect(KEYMAP.find((b) => b.action === "EXIT_100")?.doubleTap).toBe(true);
  });

  it("never marks disarm as executing, so Escape always works", () => {
    const disarm = KEYMAP.find((b) => b.action === "DISARM");
    expect(disarm?.key).toBe("Escape");
    expect(disarm?.executes).toBeFalsy();
  });

  it("never gates F6/F7 on HOT — panic controls must fire while SAFE too", () => {
    expect(KEYMAP.find((b) => b.action === "CLOSE_ALL")?.executes).toBeFalsy();
    expect(KEYMAP.find((b) => b.action === "CANCEL_ALL")?.executes).toBeFalsy();
  });
});

describe("no ambiguous bindings", () => {
  it("has exactly one binding per key+modifier combination", () => {
    const seen = new Set<string>();
    for (const b of KEYMAP) {
      const sig = [b.key.toLowerCase(), !!b.shift, !!b.alt, !!b.ctrl].join("|");
      expect(seen.has(sig), `duplicate binding for ${chordLabel(b)}`).toBe(false);
      seen.add(sig);
    }
  });

  it("claims no chord the app's global navigation uses (Ctrl+digit, Ctrl+K, Alt+A)", () => {
    for (const b of KEYMAP) {
      expect(b.ctrl, `${chordLabel(b)} would collide with global Ctrl shortcuts`).toBeFalsy();
    }
    expect(resolveBinding(key("a", { alt: true }))).toBeNull();
  });

  it("returns null for an unbound key", () => {
    expect(resolveBinding(key("z"))).toBeNull();
  });
});

describe("chordLabel", () => {
  it("renders arrows and modifiers readably for the cheat sheet", () => {
    expect(chordLabel({ action: "BUY_CALL", key: "ArrowUp", label: "", group: "Execute" })).toBe("↑");
    expect(chordLabel({ action: "CE_STRIKE_UP", key: "ArrowUp", shift: true, label: "", group: "Select" })).toBe("Shift + ↑");
    expect(chordLabel({ action: "DISARM", key: "Escape", label: "", group: "Safety" })).toBe("Esc");
  });
});
