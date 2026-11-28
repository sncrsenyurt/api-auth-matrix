import type { ObservedMatrix } from "./run-matrix.js";
import type { PolicyOperation } from "./read-policy.js";
import { findPolicy } from "./read-policy.js";

export type MismatchKind = "escalation" | "object-level" | "missing-auth" | "over-blocked";

export type Mismatch = {
  method: string;
  path: string;
  operationId?: string;
  role: string;
  status: number | null;
  kind: MismatchKind;
};

export function comparePolicy(matrix: ObservedMatrix, policy: PolicyOperation[]): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const row of matrix.operations) {
    const rule = findPolicy(policy, row.method, row.path, row.operationId);
    if (!rule?.access) continue;
    for (const role of matrix.roles) {
      const call = row.byRole[role];
      if (!call) continue;
      const kind = judge(role, rule, call.classification);
      if (!kind) continue;
      const mismatch: Mismatch = {
        method: row.method,
        path: row.path,
        role,
        status: call.status,
        kind,
      };
      if (row.operationId !== undefined) mismatch.operationId = row.operationId;
      mismatches.push(mismatch);
    }
  }
  return mismatches;
}

export function formatMismatch(mismatch: Mismatch): string {
  const name = mismatch.operationId ?? `${mismatch.method.toUpperCase()} ${mismatch.path}`;
  const status = mismatch.status === null ? "none" : String(mismatch.status);
  return `${name} ${mismatch.role} ${mismatch.kind} ${status}`;
}

function judge(
  role: string,
  rule: PolicyOperation,
  classification: "allowed" | "denied" | "error" | "other",
): MismatchKind | undefined {
  const allowed = expectsAccess(role, rule);
  if (allowed) {
    if (classification === "denied") return "over-blocked";
    return undefined;
  }
  if (classification !== "allowed") return undefined;
  if (isUnauthenticated(role)) return "missing-auth";
  if (isObjectLevel(role, rule)) return "object-level";
  return "escalation";
}

function expectsAccess(role: string, rule: PolicyOperation): boolean {
  if (rule.access === "public") return true;
  if (rule.access === "admin-only") return normalize(role) === "admin";
  if (rule.access === "owner-only") return isOwner(role);
  const names = rule.allow ?? [];
  const wanted = normalize(role);
  return names.some((name) => normalize(name) === wanted);
}

function isObjectLevel(role: string, rule: PolicyOperation): boolean {
  if (!isOtherUser(role)) return false;
  if (rule.access === "owner-only") return true;
  if (rule.access !== "listed") return false;
  const ownerListed = (rule.allow ?? []).some((name) => isOwner(name));
  return ownerListed && Object.keys(rule.resources).length > 0;
}

function isOwner(role: string): boolean {
  const name = normalize(role);
  return name === "user" || name === "owner";
}

function isOtherUser(role: string): boolean {
  const name = normalize(role);
  return name === "other" || name === "other_user" || name.startsWith("other_");
}

function isUnauthenticated(role: string): boolean {
  const name = normalize(role);
  return (
    name === "anonymous" ||
    name === "expired" ||
    name === "garbage" ||
    name.startsWith("expired_") ||
    name.startsWith("garbage_")
  );
}

function normalize(role: string): string {
  return role.trim().toLowerCase().replace(/-/g, "_");
}
