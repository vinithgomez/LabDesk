import { Select, type FieldControlProps } from "../../components/ui";
import type { Resource } from "../resources/use-resources";

/** A resource select for the admin tabs; deactivated resources are marked. Pass it a Field's control props. */
export function ResourcePicker({
  resources,
  value,
  onChange,
  ...control
}: FieldControlProps & {
  resources: Resource[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select {...control} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a resource…</option>
      {[...resources]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
            {r.isActive ? "" : " (deactivated)"}
          </option>
        ))}
    </Select>
  );
}
