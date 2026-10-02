/** Register-form rules the browser can't check by itself. */

/** The department must be chosen before an account can be created. */
export function departmentError(departmentId: string): string | null {
  return departmentId ? null : "Choose your department";
}
