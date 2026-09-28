import { useState } from "react";
import { Link } from "react-router-dom";
import { describeApiError } from "../../lib/api-errors";
import { RESOURCE_TYPES, useDebounced, useDepartments, useResources, type ResourceType } from "./use-resources";

const control =
  "min-h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

/** §11 resource directory: filter by type, search, open a resource's week calendar. */
export default function ResourcesPage() {
  const [type, setType] = useState<ResourceType | undefined>(undefined);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const resources = useResources({ type, q });
  const departments = useDepartments();
  const departmentName = (id: string) => departments.data?.find((d) => d.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-bold text-white">Resources</h1>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-400">
            Type
            <select className={control} value={type ?? ""} onChange={(e) => setType((e.target.value || undefined) as ResourceType | undefined)}>
              <option value="">All</option>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t[0]?.toUpperCase()}
                  {t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-400">
            Search
            <input
              className={`${control} w-48`}
              type="search"
              placeholder="Name, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </div>

      {resources.isError ? (
        <p role="alert" className="rounded-md bg-rose-600/20 p-2 text-sm text-rose-200">
          {describeApiError(resources.error)}
        </p>
      ) : resources.isPending ? (
        <p role="status" className="text-sm text-slate-400">
          Loading…
        </p>
      ) : resources.data.length === 0 ? (
        <p className="text-sm text-slate-400">No resources match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Location</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Capacity</th>
                <th scope="col" className="px-3 py-2 font-medium">Department</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {resources.data.map((r) => (
                <tr key={r.id} className="hover:bg-slate-900/60">
                  <td className="px-3 py-1.5">
                    <Link
                      to={`/resources/${r.id}`}
                      className="font-medium text-indigo-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      {r.name}
                    </Link>
                    {r.requiresApproval && <span className="ml-2 text-xs text-amber-300">needs approval</span>}
                  </td>
                  <td className="px-3 py-1.5 capitalize text-slate-300">{r.type}</td>
                  <td className="px-3 py-1.5 text-slate-300">{r.location}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{r.capacity === 0 ? "—" : r.capacity}</td>
                  <td className="px-3 py-1.5 text-slate-300">{departmentName(r.departmentId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
