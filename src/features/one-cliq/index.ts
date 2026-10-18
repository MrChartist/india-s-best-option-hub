/** 1Cliq Trade — one-click execution terminal. */

export { default as OneCliqTerminal } from "./OneCliqTerminal";
export { KEYMAP, chordLabel } from "./lib/keymap";
export { simulateFill, marketProtectionPrice } from "./lib/fillModel";
export type { TerminalConfig, OrderIntent, FillResult } from "./types";
