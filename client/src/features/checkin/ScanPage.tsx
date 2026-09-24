import { useState } from "react";
import { failureOutcome, successOutcome, type Outcome } from "./messages";
import { parseCheckinQr } from "./parse-qr";
import { ResultPanel } from "./ResultPanel";
import { useCheckin } from "./use-checkin";
import { useQrScanner } from "./use-qr-scanner";

const REGION_ID = "qr-scan-region";

/**
 * Full-screen scanner (CLAUDE.md §11). Loaded with React.lazy, so the
 * html5-qrcode library is a separate chunk fetched only on /scan. The camera
 * starts on a button tap, never on mount. Primary actions sit at the bottom
 * for one-handed use.
 */
export default function ScanPage() {
  const checkin = useCheckin();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const scanner = useQrScanner(REGION_ID, (text) => {
    const payload = parseCheckinQr(text);
    if (!payload) {
      setOutcome({ tone: "failure", title: "Not a LabDesk code", detail: "Scan the QR code printed on the resource." });
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
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Scan to check in or out</h1>
      {/* Always in the DOM so the camera can attach on tap; collapsed until then. */}
      <div
        id={REGION_ID}
        className={live ? "overflow-hidden rounded-3xl bg-black" : "h-0 overflow-hidden"}
        aria-label={live ? "Camera viewfinder" : undefined}
      />
      {!live && (
        <p className="flex-1 text-lg text-slate-300">
          Point your camera at the QR code on the lab, room or equipment. Scan once when you arrive, and again when
          you leave.
        </p>
      )}
      {scanner.error && (
        <p role="alert" className="rounded-2xl bg-rose-600/20 p-4 text-lg text-rose-200">
          {scanner.error}
        </p>
      )}
      <button
        type="button"
        onClick={() => (live ? void scanner.stop() : void scanner.start())}
        disabled={scanner.state === "starting"}
        className={`min-h-16 rounded-2xl text-lg font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 ${
          live ? "bg-slate-700 text-white" : "bg-indigo-600 text-white"
        }`}
      >
        {scanner.state === "starting" ? "Starting camera…" : live ? "Stop camera" : "Start camera"}
      </button>
    </div>
  );
}

function Centered({ children }: { children: string }) {
  return (
    <p role="status" aria-live="polite" className="flex flex-1 items-center justify-center text-xl text-slate-300">
      {children}
    </p>
  );
}
