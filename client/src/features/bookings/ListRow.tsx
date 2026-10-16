import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatPeriod } from "../calendar/format";

/**
 * One row of My bookings or the waitlist, designed for both sizes: on
 * phones and tablets a stacked block (resource and status on top, then the
 * time, the details and the action); from 1024px up the same parts in columns.
 */
export function ListRow({
  start,
  end,
  resourceId,
  resourceName,
  status,
  details,
  action,
}: {
  start: Date;
  end: Date;
  resourceId: string;
  resourceName: string;
  status: ReactNode;
  /** Purpose, badges and any explanation, under the resource name. */
  details: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li
      className={
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 py-4 [grid-template-areas:'res_status'_'time_time'_'det_det'_'act_act'] " +
        "lg:grid-cols-[11.75rem_minmax(0,1fr)_8.5rem_9.5rem] lg:gap-y-0.5 lg:py-3 lg:[grid-template-areas:'time_res_status_act'_'time_det_status_act']"
      }
    >
      <p className="text-body whitespace-nowrap text-ink tabular-nums [grid-area:time]">{formatPeriod(start, end)}</p>
      <div className="min-w-0 [grid-area:res]">
        <Link to={`/resources/${resourceId}`} className="text-body font-medium text-cobalt underline-offset-4 hover:underline lg:text-lead">
          {resourceName}
        </Link>
      </div>
      <div className="justify-self-end [grid-area:status] lg:justify-self-start lg:pt-0.5">{status}</div>
      <div className="min-w-0 text-body text-ink-muted [grid-area:det]">{details}</div>
      {action && <div className="pt-1 [grid-area:act] lg:justify-self-end lg:pt-0">{action}</div>}
    </li>
  );
}
