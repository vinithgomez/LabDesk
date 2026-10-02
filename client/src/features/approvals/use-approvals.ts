import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ApiError, apiRequest } from "../../lib/api";
import { describeApiError } from "../../lib/api-errors";
import { formatPeriod } from "../calendar/format";
import { approvalErrorContext, decisionSummary, type Decision, type DecisionResult, type InboxItem } from "./model";

export const inboxKey = (onlyMine: boolean) => ["approvals", "inbox", onlyMine];

/**
 * Pending bookings on resources the caller owns (admins: their department).
 * `onlyMine`: just the ones the caller can decide now (actionable=true).
 */
export function useInbox(onlyMine: boolean) {
  return useQuery({
    queryKey: inboxKey(onlyMine),
    queryFn: () =>
      apiRequest<InboxItem[]>(`/api/bookings/pending?limit=200${onlyMine ? "&actionable=true" : ""}`, { method: "GET" }),
    refetchInterval: 60_000,
  });
}

export interface Notice {
  tone: "ok" | "error";
  text: string;
}

/**
 * Approve and reject from the list. A decided item leaves the list at once;
 * a refusal (someone else decided first, the start passed, …) is explained
 * in one sentence and the inbox is refetched so it shows the truth.
 */
export function useApprovalActions(meId: string | undefined) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ item, action, comment }: { item: InboxItem; action: Decision; comment: string }) =>
      apiRequest<DecisionResult>(`/api/bookings/${item.id}/${action}`, { method: "POST", body: { comment } }),
  });

  const act = useCallback(
    async (item: InboxItem, action: Decision, comment = ""): Promise<boolean> => {
      setBusyId(item.id);
      try {
        const result = await decide.mutateAsync({ item, action, comment: comment.trim() });
        // Leaves every cached view of the inbox now, before any refetch.
        queryClient.setQueriesData<InboxItem[]>({ queryKey: ["approvals", "inbox"] }, (items) =>
          items?.filter((i) => i.id !== item.id),
        );
        setNotice({ tone: "ok", text: decisionSummary(item, action, result, formatPeriod(new Date(item.start), new Date(item.end))) });
        void queryClient.invalidateQueries({ queryKey: ["bookings"] });
        return true;
      } catch (err) {
        const ctx = meId ? { approval: approvalErrorContext(item, action, meId, new Date()) } : {};
        setNotice({ tone: "error", text: `Not ${action === "approve" ? "approved" : "rejected"}. ${describeApiError(err, ctx)}` });
        // Someone else may have acted: show the inbox as it is now.
        if (err instanceof ApiError && [403, 404, 409].includes(err.status)) {
          void queryClient.invalidateQueries({ queryKey: ["approvals", "inbox"] });
        }
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [decide, meId, queryClient],
  );

  return { act, notice, busyId, clearNotice: () => setNotice(null) };
}
