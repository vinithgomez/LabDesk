import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { cn } from "./util";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps focus inside `root` while open, closes on Escape, and returns focus
 * to whatever had it before (DESIGN.md §8).
 */
function useFocusTrap(open: boolean, onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = root.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem?.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open]);
  return root;
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "sheet": a bottom sheet (phones); "dialog": centred. */
  variant?: "dialog" | "sheet";
}

/**
 * A modal: focus trapped while open and returned on close, Escape and the
 * backdrop close it. Radius 10; floats, so it is the one place with a shadow.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "dialog" }: DialogProps) {
  const root = useFocusTrap(open, onClose);
  const titleId = useId();
  const descId = useId();
  if (!open) return null;
  const sheet = variant === "sheet";
  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex", sheet ? "items-end" : "items-center justify-center p-4")}>
      <div className="absolute inset-0 bg-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[85dvh] w-full flex-col gap-4 overflow-y-auto border border-line bg-surface p-5 shadow-float",
          sheet ? "rounded-t-panel pb-[max(1.25rem,env(safe-area-inset-bottom))]" : "max-w-md rounded-panel",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-h3 font-semibold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-body text-ink-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} className="-mt-1 -mr-2" />
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description: ReactNode;
  /** The action's name, the same verb as the button that opened it ("Cancel booking"). */
  confirmLabel: string;
  /** What keeps things as they are ("Keep booking"). */
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
}

/** One pattern for every confirm step. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = "Go back",
  danger = false,
  busy = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** A bottom sheet: the phone counterpart of a side panel or menu. */
export function Sheet(props: Omit<DialogProps, "variant">) {
  return <Dialog {...props} variant="sheet" />;
}

/**
 * A modal panel without its own header, for content that brings one (a
 * form with its heading and close button): from a side edge on tablets and
 * narrow laptops, from the bottom on phones. Focus is trapped and returned
 * like a Dialog; Escape and the backdrop (the --scrim, dark in both themes)
 * close it. From the bottom it is compact and shows a grabber, the usual
 * sign of a sheet.
 */
export function Drawer({
  open,
  onClose,
  label,
  side,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The accessible name of the panel. */
  label: string;
  side: "right" | "left" | "bottom";
  children: ReactNode;
}) {
  const root = useFocusTrap(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex", side === "right" ? "justify-end" : side === "left" ? "justify-start" : "items-end")}>
      <div className="absolute inset-0 bg-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "relative flex flex-col overflow-y-auto border-line bg-surface shadow-float",
          side === "bottom"
            ? "max-h-[72dvh] w-full rounded-t-panel border-t pb-[env(safe-area-inset-bottom)]"
            : cn("h-full w-full max-w-[22rem]", side === "right" ? "border-l" : "border-r"),
        )}
      >
        {side === "bottom" && <span aria-hidden="true" className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---- Toast ------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  tone: "info" | "error";
}

const ToastContext = createContext<(text: string, tone?: ToastItem["tone"]) => void>(() => {});

/**
 * Short confirmations ("Booking cancelled."). The viewport is an aria-live
 * region (not role="status", so pages keep their own single status region).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, tone: ToastItem["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-center gap-2 md:right-6 md:bottom-6 md:left-auto md:items-end"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-sm items-center gap-3 rounded-panel border bg-surface px-4 py-3 text-body shadow-float",
              t.tone === "error" ? "border-st-cancelled-border text-danger-text" : "border-line text-ink",
            )}
          >
            <span>{t.text}</span>
            <IconButton
              icon={X}
              label="Dismiss"
              className="-my-2 -mr-2"
              onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---- Tooltip ------------------------------------------------------------------

/**
 * A short hint on hover and keyboard focus, linked as the child's
 * description. The child must accept aria-describedby.
 */
export function Tooltip({
  text,
  children,
  side = "right",
}: {
  text: string;
  children: (props: { "aria-describedby": string }) => ReactElement;
  side?: "right" | "top";
}) {
  const id = useId();
  return (
    <span className="group/tooltip relative inline-flex">
      {children({ "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 hidden rounded-chip bg-ink px-2 py-1 text-meta whitespace-nowrap text-surface shadow-float",
          "group-focus-within/tooltip:block group-hover/tooltip:block",
          side === "right" ? "top-1/2 left-full ml-2 -translate-y-1/2" : "bottom-full left-1/2 mb-2 -translate-x-1/2",
        )}
      >
        {text}
      </span>
    </span>
  );
}
