import { CircleSlash, ClipboardCheck, Clock3, SearchX, Search, Wrench } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  cn,
  EmptyState,
  ICON_STROKE,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Table,
  type Column,
} from "../../components/ui";
import { describeApiError } from "../../lib/api-errors";
import type { BusyInterval } from "../bookings/types";
import { useNow } from "../../lib/use-now";
import { todaySummary, type TodayState } from "./today";
import {
  RESOURCE_TYPES,
  useDebounced,
  useDepartments,
  useResources,
  useTodayAvailability,
  type Resource,
  type ResourceType,
} from "./use-resources";

const TYPE_LABEL: Record<ResourceType, string> = { lab: "Lab", room: "Room", equipment: "Equipment" };

/** §11 / DESIGN.md §6 resource directory: search and filter in one row, then a table (stacked rows on phones). */
export default function ResourcesPage() {
  const [type, setType] = useState<ResourceType | undefined>(undefined);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const resources = useResources({ type, q });
  const departments = useDepartments();
  const now = useNow(60_000);
  const today = useTodayAvailability(resources.data?.map((r) => r.id) ?? [], now);
  const departmentName = (id: string) => departments.data?.find((d) => d.id === id)?.name ?? "—";
  const filtering = search.trim() !== "" || type !== undefined;

  const columns: Column<Resource>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      className: "min-w-[10.75rem]",
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <Link to={`/resources/${r.id}`} className="font-medium text-cobalt underline-offset-4 hover:underline">
            {r.name}
          </Link>
          <span className="text-small text-ink-muted">{TYPE_LABEL[r.type]}</span>
        </span>
      ),
    },
    { key: "location", header: "Location", cell: (r) => <span className="text-ink">{r.location}</span> },
    {
      key: "capacity",
      header: "Capacity",
      align: "right",
      numeric: true,
      cell: (r) => (r.capacity === 0 ? <span className="text-ink-muted">No limit</span> : r.capacity),
    },
    {
      key: "department",
      header: "Department",
      hideBelowXl: true,
      cell: (r) => <span className="text-ink-muted">{departmentName(r.departmentId)}</span>,
    },
    {
      key: "approval",
      header: "Approval",
      nowrap: true,
      cell: (r) =>
        r.requiresApproval ? (
          <Badge icon={ClipboardCheck}>Needs approval</Badge>
        ) : (
          <span className="text-ink-muted">Not needed</span>
        ),
    },
    {
      key: "today",
      header: "Today",
      nowrap: true,
      cell: (r) => <TodayCell busy={today.get(r.id)} resource={r} now={now} />,
    },
  ];

  /** Phones: designed for the narrow screen, not the table squeezed. */
  const mobileRow = (r: Resource) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Link to={`/resources/${r.id}`} className="text-lead font-medium text-cobalt underline-offset-4 hover:underline">
          {r.name}
        </Link>
        <span className="shrink-0 text-small text-ink-muted">{TYPE_LABEL[r.type]}</span>
      </div>
      <p className="text-body text-ink-muted">
        {r.location}, {departmentName(r.departmentId)}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body">
        <span className="text-ink tabular-nums">{r.capacity === 0 ? "No capacity limit" : `Up to ${r.capacity} ${r.capacity === 1 ? "person" : "people"}`}</span>
        {r.requiresApproval && <Badge icon={ClipboardCheck}>Needs approval</Badge>}
      </div>
      <TodayCell busy={today.get(r.id)} resource={r} now={now} />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Resources" description="Labs, rooms and equipment you can book. Open one to see its week and book a slot." />

      <div className="flex items-end gap-3" role="search">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-small font-medium text-ink">Search</span>
          <span className="relative block">
            <Search
              aria-hidden="true"
              size={16}
              strokeWidth={ICON_STROKE}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            />
            <Input
              type="search"
              placeholder="Name or location"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </span>
        </label>
        <label className="flex w-28 shrink-0 flex-col gap-1.5 md:w-40">
          <span className="text-small font-medium text-ink">Type</span>
          <Select value={type ?? ""} onChange={(e) => setType((e.target.value || undefined) as ResourceType | undefined)}>
            <option value="">All types</option>
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {resources.isError ? (
        <p role="alert" className="border-y border-st-cancelled-border py-3 text-body text-danger-text">
          {describeApiError(resources.error)}
        </p>
      ) : resources.isPending ? (
        <ListSkeleton />
      ) : resources.data.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtering ? "No resources match" : "No resources yet"}
          action={
            filtering ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setType(undefined);
                }}
              >
                Clear search and filter
              </Button>
            ) : undefined
          }
        >
          {filtering
            ? "Try another name or location, or show all types."
            : "An admin adds the labs, rooms and equipment your department can book."}
        </EmptyState>
      ) : (
        <Table caption="Resources" columns={columns} rows={resources.data} rowKey={(r) => r.id} mobileRow={mobileRow} />
      )}
    </div>
  );
}

const TODAY_TONE: Record<TodayState, { dot: string; text: string }> = {
  free: { dot: "bg-st-checked-in-fg", text: "text-st-checked-in-fg" },
  "in-use": { dot: "bg-cobalt", text: "text-ink" },
  maintenance: { dot: "", text: "text-ink" },
  "opens-later": { dot: "", text: "text-ink-muted" },
  closed: { dot: "", text: "text-ink-muted" },
};

/** Today at a glance: a dot (or hatch swatch for maintenance) plus words; never colour alone. */
function TodayCell({ busy, resource, now }: { busy: readonly BusyInterval[] | undefined; resource: Resource; now: Date }) {
  if (!busy) return <Skeleton className="h-4 w-28" />;
  const summary = todaySummary(busy, resource, now);
  const tone = TODAY_TONE[summary.state];
  return (
    <span className={cn("inline-flex items-center gap-2 tabular-nums", tone.text)}>
      {summary.state === "maintenance" ? (
        <Wrench aria-hidden="true" size={14} strokeWidth={ICON_STROKE} />
      ) : summary.state === "closed" ? (
        <CircleSlash aria-hidden="true" size={14} strokeWidth={ICON_STROKE} className="text-ink-faint" />
      ) : summary.state === "opens-later" ? (
        <Clock3 aria-hidden="true" size={14} strokeWidth={ICON_STROKE} className="text-ink-faint" />
      ) : (
        <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", tone.dot)} />
      )}
      {summary.label}
    </span>
  );
}

/** Rows shaped like the table it stands in for. */
function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading resources" className="flex flex-col divide-y divide-line border-y border-line">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="grid grid-cols-[2fr_1.5fr_0.6fr_1.5fr_1fr_1.4fr] gap-4 py-4 max-md:grid-cols-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32 max-md:hidden" />
          <Skeleton className="h-4 w-8 max-md:hidden" />
          <Skeleton className="h-4 w-36 max-md:hidden" />
          <Skeleton className="h-4 w-24 max-md:hidden" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
