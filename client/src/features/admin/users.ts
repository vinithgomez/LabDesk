/** Users-tab wording, pure. */
import { ROLE_LABEL, type Role } from "../auth/use-me";

const WHAT_IT_ALLOWS: Record<Role, string> = {
  student: "they can book, but can't own resources, approve or see analytics",
  faculty: "they can own and approve resources they're given and see analytics",
  lab_incharge: "they can own and approve resources they're given and see analytics",
  admin: "they can manage every resource, owner, maintenance window and user, in any department",
};

/** The confirm step for a role change, saying what changes. */
export function roleChangeWarning(user: { fullName: string; role: Role }, to: Role): string {
  const losesOwnership = user.role !== "student" && to === "student";
  return `Change ${user.fullName} from ${ROLE_LABEL[user.role]} to ${ROLE_LABEL[to]}? As ${ROLE_LABEL[to].toLowerCase()}, ${WHAT_IT_ALLOWS[to]}.${
    losesOwnership ? " Any resources they own keep them listed as an owner, but they lose the power to approve." : ""
  }`;
}
