import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ListedOperation } from "../src/list-operations.js";
import { listOperations } from "../src/list-operations.js";
import { loadOpenApi } from "../src/read-openapi.js";
import { loadPolicy } from "../src/read-policy.js";
import { loadRoles } from "../src/read-roles.js";
import { runMatrix, type ObservedCall, type ObservedMatrix } from "../src/run-matrix.js";

const specPath = path.join("test", "fixtures", "access.openapi.yaml");
const rolesPath = path.join("test", "fixtures", "roles.access.yaml");
const policyPath = path.join("test", "fixtures", "policy.access.yaml");

describe("runMatrix", () => {
  it("calls every operation as every role and classifies the status", async () => {
    const fixture = await listen(accessServer);
    try {
      const matrix = await loadAndRun(fixture.url);
      expect(matrix.roles).toEqual(["anonymous", "user", "admin", "expired"]);
      expect(matrix.operations.map((operation) => operation.operationId)).toEqual([
        "getOpen",
        "getAccount",
        "getAdminReport",
        "createNote",
        "getBroken",
        "getTrace",
        "getSession",
        "getOrder",
      ]);

      expect(call(matrix, "getOpen", "anonymous")).toEqual({ status: 200, classification: "allowed" });
      expect(call(matrix, "getOpen", "expired")).toEqual({ status: 200, classification: "allowed" });

      expect(call(matrix, "getAccount", "anonymous")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "getAccount", "expired")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "getAccount", "user")).toEqual({ status: 200, classification: "allowed" });
      expect(call(matrix, "getAccount", "admin")).toEqual({ status: 200, classification: "allowed" });

      expect(call(matrix, "getAdminReport", "anonymous")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "getAdminReport", "expired")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "getAdminReport", "user")).toEqual({ status: 403, classification: "denied" });
      expect(call(matrix, "getAdminReport", "admin")).toEqual({ status: 200, classification: "allowed" });

      expect(call(matrix, "createNote", "anonymous")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "createNote", "user")).toEqual({ status: 201, classification: "allowed" });
      expect(call(matrix, "createNote", "admin")).toEqual({ status: 201, classification: "allowed" });

      expect(call(matrix, "getBroken", "user")).toEqual({ status: 500, classification: "other" });
      expect(call(matrix, "getTrace", "user")).toEqual({ status: 404, classification: "other" });

      expect(call(matrix, "getSession", "anonymous")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "getSession", "expired")).toEqual({ status: 401, classification: "denied" });
      expect(call(matrix, "getSession", "user")).toEqual({ status: 200, classification: "allowed" });

      expect(call(matrix, "getOrder", "user")).toEqual({ status: 200, classification: "allowed" });
      expect(call(matrix, "getOrder", "admin")).toEqual({ status: 204, classification: "allowed" });
      expect(call(matrix, "getOrder", "anonymous")).toEqual({ status: 404, classification: "other" });
    } finally {
      await fixture.close();
    }
  });

  it("sends repeatable extra headers", async () => {
    const fixture = await listen(accessServer);
    try {
      const plain = await loadAndRun(fixture.url);
      const traced = await loadAndRun(fixture.url, [{ name: "X-Trace", value: "1" }]);
      expect(call(plain, "getTrace", "anonymous").status).toBe(404);
      expect(call(traced, "getTrace", "anonymous")).toEqual({ status: 200, classification: "allowed" });
      expect(call(traced, "getTrace", "expired")).toEqual({ status: 200, classification: "allowed" });
    } finally {
      await fixture.close();
    }
  });

  it("records a network failure and a timeout as error without a status", async () => {
    const operations = await listedOperations();
    const roles = await loadRoles(rolesPath);
    const open = operations.find((operation) => operation.operationId === "getOpen");
    if (!open) throw new Error("missing getOpen");

    const closed = await listen(() => undefined);
    const port = new URL(closed.url).port;
    await closed.close();
    const offline = await runMatrix({
      operations: [open],
      roles: roles.slice(0, 1),
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    });
    expect(offline.operations[0].byRole.anonymous).toEqual({ status: null, classification: "error" });

    const hanging = await listen(() => undefined);
    try {
      const timed = await runMatrix({
        operations: [open],
        roles: roles.slice(0, 1),
        baseUrl: hanging.url,
        timeoutMs: 200,
      });
      expect(timed.operations[0].byRole.anonymous).toEqual({ status: null, classification: "error" });
    } finally {
      await hanging.close();
    }
  });

  it("keeps going when one operation cannot be built", async () => {
    const fixture = await listen(accessServer);
    try {
      const operations = await listedOperations();
      const open = operations.find((operation) => operation.operationId === "getOpen");
      if (!open) throw new Error("missing getOpen");
      const broken: ListedOperation = {
        method: "get",
        path: "/widgets/{id}",
        operationId: "getWidget",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      };
      const roles = await loadRoles(rolesPath);
      const matrix = await runMatrix({
        operations: [broken, open],
        roles: roles.slice(0, 1),
        baseUrl: fixture.url,
        timeoutMs: 1000,
      });
      expect(matrix.operations[0].byRole.anonymous).toEqual({ status: null, classification: "error" });
      expect(matrix.operations[1].byRole.anonymous).toEqual({ status: 200, classification: "allowed" });
    } finally {
      await fixture.close();
    }
  });
});

async function loadAndRun(baseUrl: string, extraHeaders: { name: string; value: string }[] = []) {
  const [operations, roles, policy] = await Promise.all([
    listedOperations(),
    loadRoles(rolesPath),
    loadPolicy(policyPath),
  ]);
  return runMatrix({
    operations,
    roles,
    policy,
    baseUrl,
    timeoutMs: 3000,
    extraHeaders,
  });
}

async function listedOperations(): Promise<ListedOperation[]> {
  const loaded = await loadOpenApi(specPath);
  return listOperations(loaded.document, specPath);
}

function call(matrix: ObservedMatrix, operationId: string, role: string): ObservedCall {
  const row = matrix.operations.find((operation) => operation.operationId === operationId);
  if (!row) throw new Error(`missing ${operationId}`);
  const cell = row.byRole[role];
  if (!cell) throw new Error(`missing ${role} on ${operationId}`);
  return cell;
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    req.on("end", () => handler(req, res));
    req.resume();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, reject) => {
            server.closeAllConnections();
            server.close((err) => (err ? reject(err) : done()));
          }),
      });
    });
  });
}

function accessServer(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const status = decide(req.method ?? "GET", url, req);
  res.statusCode = status;
  res.setHeader("content-type", "text/plain");
  res.end(String(status));
}

function decide(method: string, url: URL, req: IncomingMessage): number {
  const who = bearer(req.headers.authorization);
  if (method === "GET" && url.pathname === "/open") return url.searchParams.get("limit") === "10" ? 200 : 400;
  if (method === "GET" && url.pathname === "/account") return who === "user" || who === "admin" ? 200 : 401;
  if (method === "GET" && url.pathname === "/admin/report") {
    if (who === "admin") return 200;
    if (who === "user") return 403;
    return 401;
  }
  if (method === "POST" && url.pathname === "/notes") return who === "user" || who === "admin" ? 201 : 401;
  if (method === "GET" && url.pathname === "/broken") return 500;
  if (method === "GET" && url.pathname === "/trace") return req.headers["x-trace"] === "1" ? 200 : 404;
  if (method === "GET" && url.pathname === "/session") return hasSession(req.headers.cookie) ? 200 : 401;
  if (method === "GET" && url.pathname.startsWith("/orders/")) {
    const id = decodeURIComponent(url.pathname.slice("/orders/".length));
    if (id === "ord-a") return 200;
    if (id === "ord-admin") return 204;
    return 404;
  }
  return 404;
}

function bearer(value: string | string[] | undefined): "none" | "user" | "admin" | "other" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "none";
  if (raw === "Bearer user-token") return "user";
  if (raw === "Bearer admin-token") return "admin";
  return "other";
}

function hasSession(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return false;
  return raw.split(";").some((part) => part.trim() === "session=yes");
}
