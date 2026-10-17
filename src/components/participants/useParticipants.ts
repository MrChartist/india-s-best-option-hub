import { useQuery } from "@tanstack/react-query";
import { addCalendarDays } from "@/lib/options";
import {
  fetchCashFlows,
  fetchNiftyCloses,
  loadParticipantsDashboard,
  sampleNiftyCloses,
  type DailyClose,
  type DataMode,
  type HistoryPoint,
  type Sourced,
} from "@/lib/participantsApi";

/** Participant OI dashboard for a date (null = latest published file) and a history window in days. */
export function useParticipantsDashboard(date: string | null, days: number) {
  return useQuery({
    queryKey: ["participants", "dashboard", date ?? "latest", days],
    queryFn: ({ signal }) => loadParticipantsDashboard({ date, days, signal }),
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
    placeholderData: (prev) => prev,
  });
}

/** FII / DII cash-market flows (₹ crore), recorded day by day in this browser. */
export function useCashFlows() {
  return useQuery({
    queryKey: ["participants", "cash"],
    queryFn: () => fetchCashFlows(),
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}

/**
 * NIFTY daily closes covering the participant series, for the next-day correlation. Live
 * dashboards use market closes only (null when unavailable, never sample); the sample dashboard
 * uses simulated closes so the panel can be demonstrated.
 */
export function useNiftyCloses(series: HistoryPoint[], mode: DataMode | null) {
  const from = series[0]?.date ?? "";
  const to = series[series.length - 1]?.date ?? "";
  return useQuery({
    queryKey: ["participants", "nifty", mode, from, to],
    enabled: !!mode && series.length > 2,
    queryFn: async ({ signal }): Promise<Sourced<DailyClose[]> | null> => {
      if (mode === "sample") return { data: sampleNiftyCloses(series), mode: "sample" };
      return fetchNiftyCloses(from, addCalendarDays(to, 7), signal);
    },
    staleTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });
}
