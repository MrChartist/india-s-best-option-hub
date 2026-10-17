import { createContext, useContext } from "react";

export type SimSpotKind = "live" | "delayed" | "sample";

export interface SimSpot {
  symbol: "NIFTY";
  /** Spot used by the simulators (rupees). */
  spot: number;
  kind: SimSpotKind;
  label: string;
}

/** Round illustrative NIFTY level used when no quote is available. Always labelled "Sample spot". */
export const SAMPLE_NIFTY_SPOT = 25000;

export const SAMPLE_SIM_SPOT: SimSpot = { symbol: "NIFTY", spot: SAMPLE_NIFTY_SPOT, kind: "sample", label: "Sample spot" };

export const SimSpotContext = createContext<SimSpot>(SAMPLE_SIM_SPOT);

/** Spot for the Learn simulators: live/last-saved NIFTY when a provider has one, else the labelled sample level. */
export function useSimSpot(): SimSpot {
  return useContext(SimSpotContext);
}
