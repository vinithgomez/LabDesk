import type { Outcome } from "./messages";

/** The large, unmissable result of a scan. Announced to screen readers. */
export function ResultPanel({ outcome, onAgain, againLabel }: { outcome: Outcome; onAgain: () => void; againLabel: string }) {
  const success = outcome.tone === "success";
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div
        role="status"
        aria-live="assertive"
        className={`flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl p-8 text-center ${
          success ? "bg-emerald-600" : "bg-rose-600"
        }`}
      >
        <span aria-hidden="true" className="text-8xl leading-none text-white">
          {success ? "✓" : "✕"}
        </span>
        <p className="text-3xl font-bold text-white">{outcome.title}</p>
        <p className="text-lg text-white/90">{outcome.detail}</p>
      </div>
      <button
        type="button"
        onClick={onAgain}
        className="min-h-16 rounded-2xl bg-white text-lg font-semibold text-slate-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400"
      >
        {againLabel}
      </button>
    </div>
  );
}
