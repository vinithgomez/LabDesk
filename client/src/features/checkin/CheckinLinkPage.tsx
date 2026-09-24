import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { failureOutcome, successOutcome, type Outcome } from "./messages";
import { payloadFromParams } from "./parse-qr";
import { ResultPanel } from "./ResultPanel";
import { useCheckin } from "./use-checkin";

/**
 * Where a printed QR lands when scanned with the phone's own camera app:
 * /checkin?r=<resourceId>&sig=<hmac> (CLAUDE.md §7). No camera needed. The
 * check-in is a deliberate tap, not automatic on load, so a reload or a
 * prefetch never records attendance.
 */
export default function CheckinLinkPage() {
  const [params] = useSearchParams();
  const payload = payloadFromParams(params);
  const checkin = useCheckin();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (!payload) {
    return (
      <ResultPanel
        outcome={{ tone: "failure", title: "Not a valid code", detail: "This link is incomplete. Scan the QR code on the resource again." }}
        onAgain={() => window.location.assign("/scan")}
        againLabel="Open the scanner"
      />
    );
  }
  if (outcome) {
    return <ResultPanel outcome={outcome} onAgain={() => window.location.assign("/scan")} againLabel="Open the scanner" />;
  }

  const submit = () =>
    checkin.mutate(payload, {
      onSuccess: (result) => setOutcome(successOutcome(result)),
      onError: (err) => setOutcome(failureOutcome(err)),
    });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Ready to check in</h1>
      <p className="flex-1 text-lg text-slate-300">
        Tap below to record your attendance. If you're already checked in, this checks you out.
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={checkin.isPending}
        className="min-h-16 rounded-2xl bg-indigo-600 text-lg font-semibold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300"
      >
        {checkin.isPending ? "Checking you in…" : "Check in or out"}
      </button>
      <Link to="/scan" className="text-center text-indigo-300 underline">
        Use the in-app scanner instead
      </Link>
    </div>
  );
}
