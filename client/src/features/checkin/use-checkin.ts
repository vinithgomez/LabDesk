import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import type { AttendanceResult, CheckinPayload } from "./types";

/** POST /api/checkin: first scan checks in, a second scan during the session checks out. */
export function useCheckin() {
  return useMutation({
    mutationFn: (payload: CheckinPayload) =>
      apiRequest<AttendanceResult>("/api/checkin", { method: "POST", body: payload }),
  });
}
