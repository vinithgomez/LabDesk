import { X } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, Field, Input, Select } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { ROLE_LABEL } from "../auth/use-me";
import { useDebounced } from "../resources/use-resources";
import type { OwnerDraft } from "./resource-form";
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
    <fieldset className="flex flex-col gap-3 border-t border-line pt-4" aria-describedby={error ? "owners-error" : undefined}>
      <legend className="float-left mb-1 text-body font-semibold text-ink">Owners (they approve and manage it)</legend>
      {owners.length === 0 ? (
        <p className="clear-left text-body text-ink-muted">No owners yet.</p>
      ) : (
        <ul className="clear-left flex flex-col divide-y divide-line border-y border-line">
          {owners.map((o) => {
            const user = names.get(o.userId);
            const name = user?.fullName ?? `User ${o.userId.slice(0, 8)}…`;
            return (
              <li key={o.userId} className="flex flex-wrap items-center gap-3 py-2">
                <Avatar name={user?.fullName ?? "?"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{name}</span>
                  {user && <span className="block text-small text-ink-muted">{ROLE_LABEL[user.role]}</span>}
                </span>
                <label className="flex items-center gap-2 text-small text-ink-muted">
                  Level
                  <Select
                    className="w-20"
                    value={o.approvalLevel}
                    onChange={(e) => setLevel(o.userId, e.target.value === "2" ? 2 : 1)}
                    aria-label={`Approval level for ${user?.fullName ?? "this owner"}`}
                  >
                    <option value={1}>1</option>
                    {(levels === 2 || o.approvalLevel === 2) && <option value={2}>2</option>}
                  </Select>
                </label>
                <Button variant="quiet-danger" icon={X} onClick={() => onChange(owners.filter((x) => x.userId !== o.userId))} className="px-3">
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Field label="Add an owner" className="clear-left md:max-w-md">
        {(control) => (
          <Input
            {...control}
            type="search"
            placeholder={departmentId ? "Search staff by name" : "Choose a department first"}
            disabled={!departmentId}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </Field>
      {candidates.isError && <p className="text-small text-danger-text">{describeApiError(candidates.error)}</p>}
      {q.trim() !== "" && candidates.data && (
        <ul className="flex max-h-48 flex-col overflow-y-auto rounded-control border border-line md:max-w-md" aria-label="Matching people">
          {candidates.data.length === 0 && <li className="px-3 py-2 text-small text-ink-muted">Nobody matches.</li>}
          {candidates.data.map((u) => {
            const student = u.role === "student";
            const already = ownerIds.has(u.id);
            return (
              <li key={u.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  disabled={student || already}
                  onClick={() => {
                    onChange([...owners, { userId: u.id, approvalLevel: 1 }]);
                    setSearch("");
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-body text-ink hover:bg-sunken focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
                >
                  <span className="min-w-0 truncate">
                    {u.fullName} <span className="text-small text-ink-muted">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-small">
                    {already ? "Already an owner" : student ? "Students can't own resources" : ROLE_LABEL[u.role]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p id="owners-error" className="text-small text-danger-text">
          {error}
        </p>
      )}
    </fieldset>
  );
}
