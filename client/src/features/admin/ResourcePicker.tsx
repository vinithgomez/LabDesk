import type { Resource } from "../resources/use-resources";
import { control } from "./ui";

/** A resource select for the admin tabs; deactivated resources are marked. */
export function ResourcePicker({
  id,
  resources,
  value,
  onChange,
  invalid = false,
  describedBy,
}: {
  id: string;
  resources: Resource[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      className={control}
      value={value}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose a resource…</option>
      {[...resources]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isActive ? "" : " (deactivated)"}
          </option>
        ))}
    </select>
  );
}
