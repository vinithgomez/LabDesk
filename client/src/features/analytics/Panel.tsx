import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError } from "../../lib/api";

/** A titled dashboard section that renders its query's loading and error states. */
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
    <section className={`flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 ${className}`}>
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {description && <p className="text-sm text-slate-400">{description}</p>}
      </header>
      {query.isPending ? (
        <p role="status" className="text-slate-400">
          Loading…
        </p>
      ) : query.isError ? (
        <p role="alert" className="rounded-xl bg-rose-600/20 p-3 text-rose-200">
          {query.error instanceof ApiError ? query.error.message : "Couldn't load this section."}
        </p>
      ) : (
        children(query.data)
      )}
    </section>
  );
}
