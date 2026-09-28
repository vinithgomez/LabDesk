import { useState } from "react";
import { describeApiError } from "../../lib/api-errors";
import { useCalendarFeed } from "./use-bookings";

const button =
  "min-h-8 rounded-md px-2.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50";

/** The private ICS link: copy it, or replace it after a confirm that says the old one stops working. */
export function CalendarFeed() {
  const { feed, regenerate } = useCalendarFeed();
  /** One short status line: the last copy or regenerate result. */
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied.");
    } catch {
      setNote("Couldn't copy; select the link and copy it yourself.");
    }
  };

  return (
    <section aria-labelledby="feed-heading" className="flex flex-col gap-2 rounded-lg border border-slate-800 p-3">
      <h2 id="feed-heading" className="text-sm font-semibold text-white">
        Calendar feed
      </h2>
      <p className="text-xs text-slate-400">
        Subscribe to this link in Google Calendar, Outlook or Apple Calendar to see your approved bookings. Anyone with the link can
        read them, so keep it private.
      </p>
      {feed.isError ? (
        <p role="alert" className="text-sm text-rose-300">
          {describeApiError(feed.error)}
        </p>
      ) : !feed.data ? (
        <p role="status" className="text-sm text-slate-400">
          Loading…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              readOnly
              aria-label="Calendar feed URL"
              value={feed.data.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-8 min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-xs text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            />
            <button type="button" onClick={() => void copy(feed.data.url)} className={`${button} bg-indigo-600 text-white`}>
              Copy
            </button>
            {!confirming && (
              <button type="button" onClick={() => setConfirming(true)} className={`${button} border border-slate-600 text-slate-200`}>
                Regenerate…
              </button>
            )}
          </div>
          <p aria-live="polite" className="min-h-4 text-xs text-slate-400">
            {note}
          </p>
          {confirming && (
            <div role="group" aria-label="Confirm new link" className="flex flex-col gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2">
              <p className="text-sm text-amber-100">
                Create a new link? The current link stops working immediately, everywhere it is subscribed; you'll need to add the new
                one to your calendar app.
              </p>
              {regenerate.isError && (
                <p role="alert" className="text-sm text-rose-300">
                  {describeApiError(regenerate.error)}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  disabled={regenerate.isPending}
                  onClick={() =>
                    regenerate.mutate(undefined, {
                      onSuccess: () => {
                        setConfirming(false);
                        setNote("New link created. The old link no longer works; update your calendar app.");
                      },
                    })
                  }
                  className={`${button} bg-amber-500 text-slate-950`}
                >
                  {regenerate.isPending ? "Creating…" : "Create new link"}
                </button>
                <button type="button" disabled={regenerate.isPending} onClick={() => setConfirming(false)} className={`${button} text-slate-300`}>
                  Keep current link
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
