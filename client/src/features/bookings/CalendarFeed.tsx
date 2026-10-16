import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, Input } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useCalendarFeed } from "./use-bookings";

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

  const closeConfirm = () => {
    setConfirming(false);
    regenerate.reset();
  };

  return (
    <section aria-labelledby="feed-heading" className="flex max-w-3xl flex-col gap-3 border-t border-line pt-6">
      <div>
        <h2 id="feed-heading" className="text-h3 font-semibold text-ink">
          Calendar feed
        </h2>
        <p className="mt-1 max-w-[72ch] text-body text-ink-muted">
          Subscribe to this link in Google Calendar, Outlook or Apple Calendar to see your approved bookings. Anyone with the link can
          read them, so keep it private.
        </p>
      </div>
      {feed.isError ? (
        <p role="alert" className="text-body text-danger-text">
          {describeApiError(feed.error)}
        </p>
      ) : !feed.data ? (
        <p role="status" className="text-body text-ink-muted">
          Loading…
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              aria-label="Calendar feed URL"
              value={feed.data.url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 text-ink-muted"
            />
            <div className="flex gap-2">
              <Button icon={Copy} onClick={() => void copy(feed.data.url)} className="max-sm:flex-1">
                Copy
              </Button>
              <Button variant="quiet" icon={RefreshCw} onClick={() => setConfirming(true)} className="max-sm:flex-1">
                Regenerate…
              </Button>
            </div>
          </div>
          <p aria-live="polite" className="min-h-5 text-small text-ink-muted">
            {note}
          </p>
          <ConfirmDialog
            open={confirming}
            onClose={closeConfirm}
            title="Create a new link?"
            description="The current link stops working immediately, everywhere it is subscribed; you'll need to add the new one to your calendar app."
            confirmLabel="Create new link"
            cancelLabel="Keep current link"
            busy={regenerate.isPending}
            onConfirm={() =>
              regenerate.mutate(undefined, {
                onSuccess: () => {
                  closeConfirm();
                  setNote("New link created. The old link no longer works; update your calendar app.");
                },
              })
            }
          >
            {regenerate.isError && (
              <p role="alert" className="text-body text-danger-text">
                {describeApiError(regenerate.error)}
              </p>
            )}
          </ConfirmDialog>
        </>
      )}
    </section>
  );
}
