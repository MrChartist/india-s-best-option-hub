import { createContext, useContext } from "react";
import type { Density } from "./dashboardModel";

/** Dashboard density, provided by src/pages/Index.tsx. */
export const DensityContext = createContext<Density>("comfortable");

export function useDensity(): Density {
  return useContext(DensityContext);
}

/** Class sets that change with density. */
export const DENSITY = {
  compact: { gap: "gap-2", stack: "space-y-2", pad: "p-3", padX: "px-3", headPad: "px-3 pt-2.5 pb-2", cell: "py-1", section: "pt-3 pb-1.5" },
  comfortable: { gap: "gap-3", stack: "space-y-3", pad: "p-4", padX: "px-4", headPad: "px-4 pt-3.5 pb-2.5", cell: "py-1.5", section: "pt-4 pb-2" },
} as const;

export function useDensityClasses() {
  return DENSITY[useDensity()];
}
