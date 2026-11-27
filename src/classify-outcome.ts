export type OutcomeClass = "allowed" | "denied" | "error" | "other";

export function classifyStatus(status: number): OutcomeClass {
  if (status >= 200 && status < 300) return "allowed";
  if (status === 401 || status === 403) return "denied";
  return "other";
}
