import { CircleAlert, Info, OctagonX, ShieldAlert, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, Textarea, type BadgeTone } from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import { useMe } from "../auth/use-me";
import { formatDateTime } from "../calendar/format";
import { SEVERITIES, validateIncident, type Severity } from "./maintenance";
import { ResourcePicker } from "./ResourcePicker";
import { AdminPanel, Notice } from "./ui";
import { useAdminResources } from "./use-admin-resources";
import { useIncidents, useReportIncident, useResolveIncident, type Incident, type IncidentState } from "./use-maintenance";
import { useNamesIn } from "./use-users";

/** Severity is never colour alone: tone, icon and the label. */
const SEVERITY_LOOK: Record<Severity, { tone: BadgeTone; icon: LucideIcon }> = {
  minor: { tone: "neutral", icon: Info },
  major: { tone: "pending", icon: CircleAlert },
  out_of_service: { tone: "danger", icon: OctagonX },
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
    <section className="flex flex-col gap-6" aria-label="Incidents">
      <div className="grid gap-4 md:grid-cols-[minmax(0,24rem)_10rem]">
        <Field id="in-resource" label="Resource">
          {(control) => <ResourcePicker {...control} resources={resources.data ?? []} value={resourceId} onChange={setResourceId} />}
        </Field>
        <Field label="Show">
          {(control) => (
            <Select {...control} value={state} onChange={(e) => setState(e.target.value as IncidentState)}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </Select>
          )}
        </Field>
      </div>

      {!resource ? (
        <EmptyState icon={ShieldAlert} title="Choose a resource">
          Its incidents appear here, and you can report a new one.
        </EmptyState>
      ) : (
        <>
          <ReportIncident key={resource.id} resourceId={resource.id} />
          {incidents.isError ? (
            <Notice tone="error">{describeApiError(incidents.error)}</Notice>
          ) : incidents.isPending ? (
            <div aria-label="Loading incidents" className="flex flex-col gap-2 border-y border-line py-3">
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : incidents.data.length === 0 ? (
            <p className="border-y border-line py-3 text-body text-ink-muted">
              No {state === "all" ? "" : `${state} `}incidents on {resource.name}.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label={`Incidents on ${resource.name}`}>
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
    <form onSubmit={submit} noValidate aria-label="Report an incident">
      <AdminPanel title="Report an incident">
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-[12rem_minmax(0,1fr)]">
          <Field id="in-severity" label="Severity">
            {(control) => (
              <Select {...control} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            id="in-description"
            label="What happened"
            error={error}
            helper="Out of service doesn't close the resource by itself; schedule maintenance or deactivate it if needed."
          >
            {(control) => <Textarea {...control} rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>
        {report.isError && <Notice tone="error">{describeApiError(report.error)}</Notice>}
        {report.isSuccess && <Notice tone="ok">Incident reported.</Notice>}
        <div>
          <Button type="submit" variant="primary" disabled={report.isPending}>
            {report.isPending ? "Reporting…" : "Report incident"}
          </Button>
        </div>
      </AdminPanel>
    </form>
  );
}

function IncidentRow({ incident: i, who }: { incident: Incident; who: (id: string) => string }) {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const resolve = useResolveIncident();
  const label = SEVERITIES.find((s) => s.value === i.severity)?.label ?? i.severity;
  const look = SEVERITY_LOOK[i.severity];

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={look.tone} icon={look.icon}>
          {label}
        </Badge>
        <span className="text-small text-ink-muted">
          Reported {formatDateTime(new Date(i.createdAt))} by {who(i.reportedBy)}
          {i.bookingId && ", during a booking"}.
        </span>
      </div>
      <p className="max-w-[72ch] text-body text-ink">{i.description}</p>
      {i.resolvedAt ? (
        <p className="text-small text-st-checked-in-fg">
          Resolved {formatDateTime(new Date(i.resolvedAt))} by {i.resolvedBy ? who(i.resolvedBy) : "someone"}
          {i.resolution && <>: {i.resolution}</>}
        </p>
      ) : resolving ? (
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <Field label="How it was resolved (optional)" className="md:min-w-80 md:flex-1">
            {(control) => <Input {...control} autoFocus maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button variant="primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: i.id, resolution })}>
              {resolve.isPending ? "Saving…" : "Mark resolved"}
            </Button>
            <Button variant="quiet" onClick={() => setResolving(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="quiet" onClick={() => setResolving(true)} className="-ml-3 px-3">
            Resolve…
          </Button>
        </div>
      )}
      {resolve.isError && <p className="text-small text-danger-text">{describeApiError(resolve.error)}</p>}
    </li>
  );
}
