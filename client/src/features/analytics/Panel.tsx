import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Skeleton } from "../../components/ui";
import { ApiError } from "../../lib/api";

/**
 * A titled dashboard section that renders its query's loading and error
 * states. An open section under a heading, not a card (DESIGN.md §2).
 */
export function Panel<T>({
  title,
  description,
  query,
  className = "",
  children,
}: {
  title: string;
  description?: ReactNode;
  query: UseQueryResult<T>;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 ${className}`}>
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-ink">{title}</h2>
        {description && <p className="max-w-[72ch] text-body text-ink-muted">{description}</p>}
      </header>
      {query.isPending ? (
        <div aria-label={`Loading ${title.toLowerCase()}`} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-body text-danger-text">
          {query.error instanceof ApiError ? query.error.message : "Couldn't load this section."}
        </p>
      ) : (
        children(query.data)
      )}
    </section>
  );
}
