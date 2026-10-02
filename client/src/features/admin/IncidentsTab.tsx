import { useState, type FormEvent } from "react";
import { describeApiError } from "../../lib/api-errors";
import { useMe } from "../auth/use-me";
import { formatDateTime } from "../calendar/format";
import { SEVERITIES, validateIncident, type Severity } from "./maintenance";
import { ResourcePicker } from "./ResourcePicker";
import { Field, Notice, control, link, primary } from "./ui";
import { useAdminResources } from "./use-admin-resources";
import { useIncidents, useReportIncident, useResolveIncident, type Incident, type IncidentState } from "./use-maintenance";
import { useNamesIn } from "./use-users";

const SEVERITY_CLASS: Record<Severity, string> = {
  minor: "bg-slate-400/10 text-slate-300 ring-slate-400/30",
  major: "bg-amber-400/15 text-amber-200 ring-amber-400/40",
  out_of_service: "bg-rose-400/15 text-rose-200 ring-rose-400/40",
};

/** Admin › Incidents: report, list (open / resolved / all) and resolve, per resource. */
export default function IncidentsTab() {
  const resources = useAdminResources();
  const me = useMe();
  const [resourceId, setResourceId] = useState("");
  const [state, setState] = useState<IncidentState>("open");
  const resource = resources.data?.find((r) => r.id === resourceId);
  const incidents = useIncidents(resourceId, state);
  const names = useNamesIn(resource?.departmentId);
  const who = (id: string) => (id === me.data?.id ? "you" : (names.get(id)?.fullName ?? "a user outside this list"));

  return (
    <section className="flex flex-col gap-3" aria-label="Incidents">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <label htmlFor="in-resource" className="text-xs text-slate-400">
            Resource
          </label>
          <ResourcePicker id="in-resource" resources={resources.data ?? []} value={resourceId} onChange={setResourceId} />
        </div>
        <label className="flex flex-col text-xs text-slate-400">
          Show
          <select className={`${control} w-32`} value={state} onChange={(e) => setState(e.target.value as IncidentState)}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>

      {resource && (
        <>
          <ReportIncident key={resource.id} resourceId={resource.id} />
          {incidents.isError ? (
            <Notice tone="error">{describeApiError(incidents.error)}</Notice>
          ) : incidents.isPending ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : incidents.data.length === 0 ? (
            <p className="text-sm text-slate-400">No {state === "all" ? "" : `${state} `}incidents on {resource.name}.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-800 rounded-lg border border-slate-800" aria-label={`Incidents on ${resource.name}`}>
              {incidents.data.map((i) => (
                <IncidentRow key={i.id} incident={i} who={who} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ReportIncident({ resourceId }: { resourceId: string }) {
  const [severity, setSeverity] = useState<Severity>("minor");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>();
  const report = useReportIncident();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = validateIncident({ resourceId, description });
    setError(found.description);
    if (found.description) return;
    report.mutate({ resourceId, severity, description }, { onSuccess: () => setDescription("") });
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Report an incident" className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3">
      <h2 className="text-sm font-semibold text-white">Report an incident</h2>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <Field id="in-severity" label="Severity">
          {(a11y) => (
            <select {...a11y} className={control} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="in-description" label="What happened" error={error} hint="Out of service doesn't close the resource by itself; schedule maintenance or deactivate it if needed.">
          {(a11y) => <textarea {...a11y} rows={2} maxLength={2000} className={`${control} py-1`} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
      {report.isError && <Notice tone="error">{describeApiError(report.error)}</Notice>}
      {report.isSuccess && <Notice tone="ok">Incident reported.</Notice>}
      <div>
        <button type="submit" disabled={report.isPending} className={primary}>
          {report.isPending ? "Reporting…" : "Report incident"}
        </button>
      </div>
    </form>
  );
}

function IncidentRow({ incident: i, who }: { incident: Incident; who: (id: string) => string }) {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const resolve = useResolveIncident();
  const label = SEVERITIES.find((s) => s.value === i.severity)?.label ?? i.severity;

  return (
    <li className="flex flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 text-[11px] font-semibold ring-1 ring-inset ${SEVERITY_CLASS[i.severity]}`}>{label}</span>
        <span className="text-xs text-slate-400">
          {formatDateTime(new Date(i.createdAt))} · reported by {who(i.reportedBy)}
          {i.bookingId && " · during a booking"}
        </span>
      </div>
      <p className="text-slate-200">{i.description}</p>
      {i.resolvedAt ? (
        <p className="text-xs text-emerald-300">
          Resolved {formatDateTime(new Date(i.resolvedAt))} by {i.resolvedBy ? who(i.resolvedBy) : "—"}
          {i.resolution && <>: {i.resolution}</>}
        </p>
      ) : resolving ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-slate-400">
            How it was resolved (optional)
            <input autoFocus className={control} maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </label>
          <button type="button" disabled={resolve.isPending} className={primary} onClick={() => resolve.mutate({ id: i.id, resolution })}>
            {resolve.isPending ? "Saving…" : "Mark resolved"}
          </button>
          <button type="button" className={link} onClick={() => setResolving(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button type="button" className={link} onClick={() => setResolving(true)}>
            Resolve…
          </button>
        </div>
      )}
      {resolve.isError && <p className="text-xs text-rose-300">{describeApiError(resolve.error)}</p>}
    </li>
  );
}
