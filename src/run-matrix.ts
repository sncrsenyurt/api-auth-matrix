import type { APIRequestContext } from "@playwright/test";
import type { HeaderLine } from "./parse-flags.js";
import type { ListedOperation } from "./list-operations.js";
import type { PolicyOperation } from "./read-policy.js";
import type { RoleAuth } from "./read-roles.js";
import { buildRequest, type BuiltRequest } from "./build-request.js";
import { classifyStatus, type OutcomeClass } from "./classify-outcome.js";
import { findPolicy } from "./read-policy.js";
import { createRequestContext } from "./request-context.js";

export type ObservedCall = {
  status: number | null;
  classification: OutcomeClass;
};

export type ObservedOperation = {
  method: string;
  path: string;
  operationId?: string;
  byRole: Record<string, ObservedCall>;
};

export type ObservedMatrix = {
  roles: string[];
  operations: ObservedOperation[];
};

export async function runMatrix(input: {
  operations: ListedOperation[];
  roles: RoleAuth[];
  policy?: PolicyOperation[];
  baseUrl: string;
  timeoutMs: number;
  extraHeaders?: HeaderLine[];
}): Promise<ObservedMatrix> {
  const policy = input.policy ?? [];
  const extraHeaders = input.extraHeaders ?? [];
  const operations: ObservedOperation[] = input.operations.map((operation) => {
    const row: ObservedOperation = {
      method: operation.method,
      path: operation.path,
      byRole: {},
    };
    if (operation.operationId !== undefined) row.operationId = operation.operationId;
    return row;
  });

  const context = await createRequestContext({
    baseURL: input.baseUrl,
    timeout: input.timeoutMs,
  });
  try {
    for (const role of input.roles) {
      for (let index = 0; index < input.operations.length; index += 1) {
        const operation = input.operations[index];
        operations[index].byRole[role.name] = await sendOne(
          context,
          operation,
          role,
          policy,
          extraHeaders,
          input.timeoutMs,
        );
      }
    }
  } finally {
    await context.dispose();
  }

  return {
    roles: input.roles.map((role) => role.name),
    operations,
  };
}

async function sendOne(
  context: APIRequestContext,
  operation: ListedOperation,
  role: RoleAuth,
  policy: PolicyOperation[],
  extraHeaders: HeaderLine[],
  timeoutMs: number,
): Promise<ObservedCall> {
  let built: BuiltRequest;
  try {
    const mapped = findPolicy(policy, operation.method, operation.path, operation.operationId);
    built = buildRequest(operation, role.resources, mapped?.resources ?? {});
  } catch {
    return { status: null, classification: "error" };
  }

  const headers = mergeHeaders(extraHeaders, built, role);
  const params = new URLSearchParams();
  for (const pair of built.query) params.append(pair.name, pair.value);

  try {
    const response = await context.fetch(built.path, {
      method: built.method.toUpperCase(),
      headers,
      params: built.query.length > 0 ? params : undefined,
      data: requestData(built),
      timeout: timeoutMs,
      failOnStatusCode: false,
    });
    const status = response.status();
    await response.dispose().catch(() => undefined);
    return { status, classification: classifyStatus(status) };
  } catch {
    return { status: null, classification: "error" };
  }
}

function mergeHeaders(extraHeaders: HeaderLine[], built: BuiltRequest, role: RoleAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of extraHeaders) headers[header.name] = header.value;
  for (const [name, value] of Object.entries(built.headers)) headers[name] = value;
  if (built.contentType && built.body !== undefined && !hasHeader(headers, "content-type")) {
    headers["Content-Type"] = built.contentType;
  }
  for (const [name, value] of Object.entries(role.headers)) headers[name] = value;

  const cookie = cookieHeader(built.cookies, role.cookies);
  if (cookie && !hasHeader(headers, "cookie")) headers.Cookie = cookie;
  return headers;
}

function cookieHeader(built: Record<string, string>, role: Record<string, string>): string | undefined {
  const cookies = { ...built, ...role };
  const parts = Object.entries(cookies).map(([name, value]) => `${name}=${value}`);
  if (parts.length === 0) return undefined;
  return parts.join("; ");
}

function requestData(built: BuiltRequest): string | Record<string, unknown> | unknown[] | undefined {
  if (built.body === undefined) return undefined;
  if (built.method === "get" || built.method === "head") return undefined;
  if (typeof built.body === "string") return built.body;
  if (Array.isArray(built.body)) return built.body;
  if (isRecord(built.body)) return built.body;
  return undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
