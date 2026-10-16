import { ScanLine } from "lucide-react";
import { useState } from "react";
import { Button, cn, ICON_STROKE, PageHeader } from "../../components/ui";
import { failureOutcome, successOutcome, type Outcome } from "./messages";
import { parseCheckinQr } from "./parse-qr";
import { ResultPanel } from "./ResultPanel";
import { useCheckin } from "./use-checkin";
import { useQrScanner } from "./use-qr-scanner";

const REGION_ID = "qr-scan-region";

/**
 * Full-screen scanner (CLAUDE.md §11). Loaded with React.lazy, so the
 * html5-qrcode library is a separate chunk fetched only on /scan. The camera
 * starts on a button tap, never on mount. One scan, one action: a result
 * replaces the camera until the person chooses to scan again. Primary actions
 * sit at the bottom for one-handed use.
 */
export default function ScanPage() {
  const checkin = useCheckin();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const scanner = useQrScanner(REGION_ID, (text) => {
    const payload = parseCheckinQr(text);
    if (!payload) {
      setOutcome({
        tone: "failure",
        title: "Not a LabDesk code",
        detail: "That QR code isn't one of LabDesk's.",
        next: "Scan the QR code printed on the resource.",
      });
      return;
    }
    checkin.mutate(payload, {
      onSuccess: (result) => setOutcome(successOutcome(result)),
      onError: (err) => setOutcome(failureOutcome(err)),
    });
  });

  const reset = () => {
    setOutcome(null);
    checkin.reset();
  };

  if (outcome) return <ResultPanel outcome={outcome} onAgain={reset} againLabel="Scan again" />;
  if (checkin.isPending) return <Centered>Checking you in…</Centered>;

  const live = scanner.state === "starting" || scanner.state === "scanning";
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader className="pb-0" title="Scan to check in or out" />
      <p className="text-lead text-ink">Scan the QR code on the resource: once when you arrive, once when you leave.</p>

      {/* The camera area. The region is always in the DOM so the camera can attach on tap; collapsed until then. */}
      <div className="relative overflow-hidden rounded-panel border border-line bg-sunken">
        <div id={REGION_ID} className={live ? "w-full" : "h-0 overflow-hidden"} aria-label={live ? "Camera viewfinder" : undefined} />
        {live ? (
          // Corner marks: where to hold the code.
          <span aria-hidden="true" className="pointer-events-none absolute inset-8">
            {["top-0 left-0 border-t-4 border-l-4", "top-0 right-0 border-t-4 border-r-4", "bottom-0 left-0 border-b-4 border-l-4", "right-0 bottom-0 border-r-4 border-b-4"].map(
              (corner) => (
                <span key={corner} className={cn("absolute size-10 rounded-chip border-on-cobalt", corner)} />
              ),
            )}
          </span>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 text-ink-muted md:aspect-[16/10]">
            <ScanLine aria-hidden="true" size={64} strokeWidth={ICON_STROKE} />
            <p className="text-body">The camera is off.</p>
          </div>
        )}
      </div>

      {scanner.error && (
        <p role="alert" className="rounded-control border border-st-cancelled-border bg-st-cancelled-bg px-4 py-3 text-lead text-st-cancelled-fg">
          {scanner.error}
        </p>
      )}
      <Button
        variant={live ? "secondary" : "primary"}
        onClick={() => (live ? void scanner.stop() : void scanner.start())}
        disabled={scanner.state === "starting"}
        className="mt-auto min-h-14 text-lead"
      >
        {scanner.state === "starting" ? "Starting camera…" : live ? "Stop camera" : "Start camera"}
      </Button>
    </div>
  );
}

function Centered({ children }: { children: string }) {
  return (
    <p role="status" aria-live="polite" className="flex min-h-[22rem] flex-1 items-center justify-center text-h3 text-ink-muted">
      {children}
    </p>
  );
}
