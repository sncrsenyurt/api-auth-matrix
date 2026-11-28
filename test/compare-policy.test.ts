import { describe, expect, it } from "vitest";
import { comparePolicy, formatMismatch } from "../src/compare-policy.js";
import type { PolicyOperation } from "../src/read-policy.js";
import type { ObservedCall, ObservedMatrix } from "../src/run-matrix.js";

const roles = ["anonymous", "user", "other_user", "admin", "expired", "garbage"];

describe("comparePolicy", () => {
  it("flags admin-only holes and leaves a real admin alone", () => {
    const mismatches = comparePolicy(
      observed([
        {
          id: "getReport",
          calls: {
            anonymous: allowed(),
            user: allowed(),
            other_user: allowed(201),
            admin: allowed(),
            expired: allowed(),
            garbage: denied(401),
          },
        },
      ]),
      [rule("getReport", { access: "admin-only" })],
    );
    expect(mismatches.map((mismatch) => [mismatch.role, mismatch.kind, mismatch.status])).toEqual([
      ["anonymous", "missing-auth", 200],
      ["user", "escalation", 200],
      ["other_user", "escalation", 201],
      ["expired", "missing-auth", 200],
    ]);
  });

  it("treats another user on the owner's object as an object-level leak", () => {
    const mismatches = comparePolicy(
      observed([
        {
          id: "getOrder",
          path: "/orders/{id}",
          calls: {
            anonymous: denied(401),
            user: allowed(),
            other_user: allowed(),
            admin: allowed(),
            expired: allowed(204),
            garbage: denied(401),
          },
        },
      ]),
      [rule("getOrder", { access: "owner-only", resources: { id: "orderId" } })],
    );
    expect(mismatches.map((mismatch) => [mismatch.role, mismatch.kind])).toEqual([
      ["other_user", "object-level"],
      ["admin", "escalation"],
      ["expired", "missing-auth"],
    ]);
    expect(mismatches[1].status).toBe(200);
    expect(mismatches[2].status).toBe(204);
  });

  it("uses an allow list, and calls a blocked owner over-blocked", () => {
    const mismatches = comparePolicy(
      observed([
        {
          id: "getOrder",
          calls: {
            anonymous: allowed(),
            user: denied(403),
            other_user: allowed(),
            admin: allowed(),
            expired: denied(401),
            garbage: allowed(),
          },
        },
        {
          id: "listReports",
          calls: {
            anonymous: denied(401),
            user: allowed(),
            other_user: allowed(),
            admin: denied(403),
            expired: denied(401),
            garbage: denied(401),
          },
        },
      ]),
      [
        rule("getOrder", { access: "listed", allow: ["user", "admin"], resources: { id: "orderId" } }),
        rule("listReports", { access: "listed", allow: ["admin"] }),
      ],
    );
    expect(mismatches.map((mismatch) => `${mismatch.operationId} ${mismatch.role} ${mismatch.kind}`)).toEqual([
      "getOrder anonymous missing-auth",
      "getOrder user over-blocked",
      "getOrder other_user object-level",
      "getOrder garbage missing-auth",
      "listReports user escalation",
      "listReports other_user escalation",
      "listReports admin over-blocked",
    ]);
  });

  it("treats public as every role, including anonymous", () => {
    const mismatches = comparePolicy(
      observed([
        {
          id: "getHealth",
          calls: {
            anonymous: denied(401),
            user: allowed(),
            other_user: allowed(),
            admin: allowed(),
            expired: allowed(),
            garbage: denied(403),
          },
        },
      ]),
      [rule("getHealth", { access: "public" })],
    );
    expect(mismatches.map((mismatch) => [mismatch.role, mismatch.kind, mismatch.status])).toEqual([
      ["anonymous", "over-blocked", 401],
      ["garbage", "over-blocked", 403],
    ]);
  });

  it("ignores network errors, other statuses, and operations with no access rule", () => {
    const mismatches = comparePolicy(
      observed([
        {
          id: "getHealth",
          calls: {
            anonymous: { status: null, classification: "error" },
            user: { status: 500, classification: "other" },
            other_user: { status: 404, classification: "other" },
            admin: allowed(),
            expired: { status: null, classification: "error" },
            garbage: { status: 500, classification: "other" },
          },
        },
        {
          id: "getNote",
          calls: {
            anonymous: allowed(),
            user: allowed(),
            other_user: allowed(),
            admin: allowed(),
            expired: allowed(),
            garbage: allowed(),
          },
        },
      ]),
      [
        rule("getHealth", { access: "public" }),
        rule("getNote", { resources: { id: "noteId" } }),
      ],
    );
    expect(mismatches).toEqual([]);
  });

  it("matches a method and path when the operation id is absent", () => {
    const matrix = observed([
      {
        id: "getReport",
        method: "get",
        path: "/admin/report",
        calls: {
          anonymous: denied(401),
          user: allowed(),
          other_user: denied(403),
          admin: allowed(),
          expired: denied(401),
          garbage: denied(401),
        },
      },
    ]);
    delete matrix.operations[0].operationId;
    const mismatches = comparePolicy(matrix, [
      rule("GET /admin/report", { access: "admin-only" }),
      rule("getReport", { access: "public" }),
    ]);
    expect(mismatches.map((mismatch) => mismatch.kind)).toEqual(["escalation"]);
    expect(mismatches[0].operationId).toBeUndefined();
    expect(mismatches[0].path).toBe("/admin/report");
  });

  it("prefers the operation id rule over a path rule", () => {
    const mismatches = comparePolicy(
      observed([
        {
          id: "getOrder",
          method: "get",
          path: "/orders/{id}",
          calls: {
            anonymous: denied(401),
            user: allowed(),
            other_user: denied(403),
            admin: denied(403),
            expired: denied(401),
            garbage: denied(401),
          },
        },
      ]),
      [
        rule("getOrder", { access: "admin-only" }),
        rule("GET /orders/{id}", { access: "public" }),
      ],
    );
    expect(mismatches.map((mismatch) => [mismatch.role, mismatch.kind])).toEqual([
      ["user", "escalation"],
      ["admin", "over-blocked"],
    ]);
  });

  it("accepts other-user and expired_token names", () => {
    const matrix: ObservedMatrix = {
      roles: ["Other-User", "expired_token"],
      operations: [
        {
          method: "get",
          path: "/orders/{id}",
          operationId: "getOrder",
          byRole: {
            "Other-User": allowed(),
            expired_token: allowed(),
          },
        },
      ],
    };
    const mismatches = comparePolicy(matrix, [
      rule("getOrder", { access: "owner-only", resources: { id: "orderId" } }),
    ]);
    expect(mismatches.map((mismatch) => [mismatch.role, mismatch.kind])).toEqual([
      ["Other-User", "object-level"],
      ["expired_token", "missing-auth"],
    ]);
  });

  it("skips a role the matrix did not call", () => {
    const matrix = observed([
      {
        id: "getReport",
        calls: {
          anonymous: allowed(),
          user: allowed(),
          admin: allowed(),
        },
      },
    ]);
    delete matrix.operations[0].byRole.user;
    const mismatches = comparePolicy(matrix, [rule("getReport", { access: "admin-only" })]);
    expect(mismatches.map((mismatch) => mismatch.role)).toEqual(["anonymous"]);
  });

  it("formats one plain line", () => {
    const [mismatch] = comparePolicy(
      observed([
        {
          id: "getReport",
          calls: { anonymous: denied(401), user: allowed(), admin: allowed() },
        },
      ]),
      [rule("getReport", { access: "admin-only" })],
    );
    expect(formatMismatch(mismatch)).toBe("getReport user escalation 200");
  });
});

function rule(
  key: string,
  fields: { access?: PolicyOperation["access"]; allow?: string[]; resources?: Record<string, string> },
): PolicyOperation {
  return {
    key,
    resources: fields.resources ?? {},
    ...(fields.access ? { access: fields.access } : {}),
    ...(fields.allow ? { allow: fields.allow } : {}),
  };
}

function observed(
  rows: Array<{ id: string; method?: string; path?: string; calls: Record<string, ObservedCall> }>,
): ObservedMatrix {
  return {
    roles,
    operations: rows.map((row) => ({
      method: row.method ?? "get",
      path: row.path ?? `/${row.id}`,
      operationId: row.id,
      byRole: row.calls,
    })),
  };
}

function allowed(status = 200): ObservedCall {
  return { status, classification: "allowed" };
}

function denied(status: number): ObservedCall {
  return { status, classification: "denied" };
}
