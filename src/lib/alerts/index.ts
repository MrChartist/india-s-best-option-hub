/**
 * Unified alerts: one rule model (types), validation, migration from the older stores, pure
 * evaluation, delivery channels and the persisted store. The runtime lives in
 * hooks/useAlertEngine.ts and the UI in components/alerts and pages/Alerts.tsx.
 */
export * from "./types";
export * from "./describe";
export * from "./validate";
export * from "./migrate";
export * from "./model";
export * from "./evaluate";
export * from "./context";
export * from "./channels";
export * from "./deliveryRegistry";
export * from "./store";
export * from "./coverage";
