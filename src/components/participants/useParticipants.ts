import { useQuery } from "@tanstack/react-query";
import { fetchCashFlows, loadParticipantsDashboard } from "@/lib/participantsApi";

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
