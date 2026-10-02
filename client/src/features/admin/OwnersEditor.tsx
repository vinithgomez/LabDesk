import { useState } from "react";
import { describeApiError } from "../../lib/api-errors";
import { ROLE_LABEL } from "../auth/use-me";
import { useDebounced } from "../resources/use-resources";
import type { OwnerDraft } from "./resource-form";
import { control, link } from "./ui";
import { useNamesIn, useUsers } from "./use-users";

/**
 * Owners and the level each decides at. Candidates come from the resource's
 * department (GET /api/users); students are listed but can't be picked,
 * since only staff may own resources.
 */
export function OwnersEditor({
  departmentId,
  owners,
  levels,
  error,
  onChange,
}: {
  departmentId: string;
  owners: OwnerDraft[];
  /** Approval levels the resource uses; owner levels must stay within them. */
  levels: 1 | 2;
  error?: string;
  onChange: (owners: OwnerDraft[]) => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const candidates = useUsers({ q, departmentId, activeOnly: true }, departmentId !== "" && q.trim() !== "");
  const names = useNamesIn(departmentId || undefined);
  const ownerIds = new Set(owners.map((o) => o.userId));

  const setLevel = (userId: string, approvalLevel: 1 | 2) =>
    onChange(owners.map((o) => (o.userId === userId ? { ...o, approvalLevel } : o)));

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-slate-800 p-2" aria-describedby={error ? "owners-error" : undefined}>
      <legend className="px-1 text-xs text-slate-400">Owners (they approve and manage it)</legend>
      {owners.length === 0 ? (
        <p className="text-xs text-slate-500">No owners.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {owners.map((o) => {
            const user = names.get(o.userId);
            return (
              <li key={o.userId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-100">
                  {user ? `${user.fullName} (${ROLE_LABEL[user.role]})` : `User ${o.userId.slice(0, 8)}…`}
                </span>
                <label className="flex items-center gap-1 text-xs text-slate-400">
                  Level
                  <select
                    className={`${control} w-16`}
                    value={o.approvalLevel}
                    onChange={(e) => setLevel(o.userId, e.target.value === "2" ? 2 : 1)}
                    aria-label={`Approval level for ${user?.fullName ?? "this owner"}`}
                  >
                    <option value={1}>1</option>
                    {(levels === 2 || o.approvalLevel === 2) && <option value={2}>2</option>}
                  </select>
                </label>
                <button type="button" className={link} onClick={() => onChange(owners.filter((x) => x.userId !== o.userId))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Add an owner
        <input
          className={control}
          type="search"
          placeholder={departmentId ? "Search staff by name" : "Choose a department first"}
          disabled={!departmentId}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {candidates.isError && <p className="text-xs text-rose-300">{describeApiError(candidates.error)}</p>}
      {q.trim() !== "" && candidates.data && (
        <ul className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-slate-800" aria-label="Matching people">
          {candidates.data.length === 0 && <li className="px-2 py-1 text-xs text-slate-500">Nobody matches.</li>}
          {candidates.data.map((u) => {
            const student = u.role === "student";
            const already = ownerIds.has(u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={student || already}
                  onClick={() => {
                    onChange([...owners, { userId: u.id, approvalLevel: 1 }]);
                    setSearch("");
                  }}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                >
                  <span className="truncate">
                    {u.fullName} <span className="text-xs text-slate-400">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-xs">
                    {already ? "Already an owner" : student ? "Students can't own resources" : ROLE_LABEL[u.role]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p id="owners-error" className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </fieldset>
  );
}
