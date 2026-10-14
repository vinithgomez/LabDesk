import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./util";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** A count or note after the label. */
  meta?: ReactNode;
}

/** Tabs (tablist/tab), arrow keys move between them. The caller renders the matching tabpanel. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
}: {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Tab ids are `${idPrefix}-tab-${id}`, panels `${idPrefix}-panel-${id}`. */
  idPrefix: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const at = tabs.findIndex((t) => t.id === value);
    const next = tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-body font-medium whitespace-nowrap md:min-h-9",
              "transition-colors duration-150 ease-out",
              selected ? "border-cobalt text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.meta !== undefined && <span className="text-small text-ink-faint tabular-nums">{t.meta}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
  /** Numbers, times and dates: tabular figures. */
  numeric?: boolean;
  /** Hide the label in the phone's stacked rows (e.g. the row's title column). */
  primary?: boolean;
  /**
   * Drop the column below 1280px to keep the rest readable: on tablets and on
   * narrow laptops, where the 232px rail leaves only about 730px of content.
   */
  hideBelowXl?: boolean;
  /** Keep the cell on one line (times, short states). */
  nowrap?: boolean;
  className?: string;
}

/**
 * A data table with a sticky header and row hover; below 768px each row
 * becomes a stacked block (the primary column as its title, the rest as
 * label/value pairs). Only one of the two is ever displayed.
 */
export function Table<Row>({
  columns,
  rows,
  rowKey,
  caption,
  mobileRow,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Names the table for screen readers. */
  caption: string;
  /** A phone layout designed for this list; without it, label/value pairs. */
  mobileRow?: (row: Row) => ReactNode;
}) {
  const primary = columns.find((c) => c.primary);
  const rest = columns.filter((c) => !c.primary);
  return (
    <>
      <table className="hidden w-full border-collapse text-left text-body md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "sticky top-0 z-10 border-b border-line bg-sunken px-3 py-2 text-small font-medium whitespace-nowrap text-ink-muted",
                  c.align === "right" && "text-right",
                  c.hideBelowXl && "hidden xl:table-cell",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line transition-colors duration-150 ease-out hover:bg-sunken/60">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-3 py-2.5 align-top",
                    c.align === "right" && "text-right",
                    c.numeric && "tabular-nums",
                    c.nowrap && "whitespace-nowrap",
                    c.hideBelowXl && "hidden xl:table-cell",
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label={caption} className="divide-y divide-line border-y border-line md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex flex-col gap-1.5 py-3">
            {mobileRow ? (
              mobileRow(row)
            ) : (
              <>
                {primary && <div className="text-lead">{primary.cell(row)}</div>}
                <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 text-body">
                  {rest.map((c) => (
                    <div key={c.key} className="contents">
                      <dt className="text-ink-muted">{c.header}</dt>
                      <dd className={cn("m-0 text-ink", c.numeric && "tabular-nums")}>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
