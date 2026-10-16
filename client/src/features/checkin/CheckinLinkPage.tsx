import { QrCode } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, ICON_STROKE, PageHeader } from "../../components/ui";
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
        outcome={{
          tone: "failure",
          title: "Not a valid code",
          detail: "This link is incomplete.",
          next: "Scan the QR code on the resource again.",
        }}
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
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader className="pb-0" title="Ready to check in" />
      <p className="text-lead text-ink">Tap below to record your attendance. If you&apos;re already checked in, this checks you out.</p>
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-panel border border-line bg-sunken text-ink-muted md:aspect-[16/10]">
        <QrCode aria-hidden="true" size={64} strokeWidth={ICON_STROKE} />
        <p className="text-body">Code read from the resource&apos;s QR link.</p>
      </div>
      <Button variant="primary" onClick={submit} disabled={checkin.isPending} className="mt-auto min-h-14 text-lead">
        {checkin.isPending ? "Checking you in…" : "Check in or out"}
      </Button>
      <Link to="/scan" className="text-center text-body font-medium text-cobalt underline-offset-4 hover:underline">
        Use the in-app scanner instead
      </Link>
    </div>
  );
}
