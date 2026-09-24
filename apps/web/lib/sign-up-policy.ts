/** Explicit opt-in only; an unset or misspelled value keeps registration closed. */
export function signUpDisabled(value: string | undefined): boolean {
  return value !== "false";
}
