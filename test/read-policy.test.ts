import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPolicy, loadPolicy } from "../src/read-policy.js";

const ordersPolicy = path.join("test", "fixtures", "policy.orders.yaml");

describe("loadPolicy", () => {
  it("reads allow lists and parameter resource names", async () => {
    const operations = await loadPolicy(ordersPolicy);
    expect(operations.map((operation) => operation.key)).toEqual([
      "getOrder",
      "deleteOrder",
      "addNote",
      "listNotes",
      "GET /orders/{id}",
    ]);
    expect(operations[0]).toEqual({
      key: "getOrder",
      access: "listed",
      allow: ["user", "admin"],
      resources: { id: "orderId" },
    });
    expect(operations[2]).toEqual({ key: "addNote", resources: { id: "orderId" } });
    expect(findPolicy(operations, "get", "/orders/{id}", "getOrder")?.resources).toEqual({ id: "orderId" });
    expect(findPolicy(operations, "get", "/orders/{id}")?.key).toBe("GET /orders/{id}");
  });

  it("rejects unknown keys, a bad allow list, and a missing file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "policy-"));
    const unknown = path.join(dir, "unknown.yaml");
    const allow = path.join(dir, "allow.yaml");
    const resource = path.join(dir, "resource.yaml");
    await writeFile(unknown, "getOrder:\n  mode: strict\n");
    await writeFile(allow, "getOrder:\n  allow: user\n");
    await writeFile(resource, "getOrder:\n  resources:\n    id: order id\n");
    await expect(loadPolicy(unknown)).rejects.toThrow(
      /operation "getOrder" has unknown key "mode" \(allowed: allow, resources\)/,
    );
    await expect(loadPolicy(allow)).rejects.toThrow(
      /allow must be public, admin only, owner only, or a list of roles/,
    );
    await expect(loadPolicy(resource)).rejects.toThrow(/resources\.id must name a resource/);
    await expect(loadPolicy(path.join(dir, "nope.yaml"))).rejects.toThrow(/policy file not found/);
  });

  it("reads public, admin only, and owner only", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "policy-"));
    const file = path.join(dir, "access.yaml");
    await writeFile(
      file,
      [
        "getHealth:",
        "  allow: public",
        "getReport:",
        "  allow: Admin Only",
        "getOrder:",
        "  allow: owner   only",
        "  resources:",
        "    id: orderId",
        "lockdown:",
        "  allow: []",
        "",
      ].join("\n"),
    );
    const operations = await loadPolicy(file);
    expect(operations.map((operation) => [operation.key, operation.access, operation.allow ?? null])).toEqual([
      ["getHealth", "public", null],
      ["getReport", "admin-only", null],
      ["getOrder", "owner-only", null],
      ["lockdown", "listed", []],
    ]);
    expect(operations[2].resources).toEqual({ id: "orderId" });
  });
});
