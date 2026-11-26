import { readFile } from "node:fs/promises";
import { parseAllDocuments } from "yaml";
import { listOperations } from "./list-operations.js";

export type OpenApiOperation = {
  method: string;
  path: string;
  operationId?: string;
};

export type LoadedOpenApi = {
  location: string;
  version: string;
  operations: OpenApiOperation[];
  document: Record<string, unknown>;
};

export async function loadOpenApi(location: string): Promise<LoadedOpenApi> {
  const text = await readSpecText(location);
  const parsed = parseSpec(text, location);
  if (!isRecord(parsed)) throw new Error(`${location}: spec must be a mapping`);
  const version = readVersion(parsed, location);
  const operations = readOperations(parsed, location);
  return { location, version, operations, document: parsed };
}

async function readSpecText(location: string): Promise<string> {
  if (/^https?:\/\//i.test(location)) {
    let response: Response;
    try {
      response = await fetch(location);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`could not fetch spec ${location}: ${message}`);
    }
    if (!response.ok) {
      throw new Error(`could not fetch spec ${location}: HTTP ${response.status}`);
    }
    return response.text();
  }

  try {
    return await readFile(location, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`spec file not found: ${location}`);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read spec ${location}: ${message}`);
  }
}

function parseSpec(text: string, location: string): unknown {
  const body = text.replace(/^\uFEFF/, "");
  const trimmed = body.trim();
  if (!trimmed) throw new Error(`${location}: spec is empty`);

  const pathOnly = location.split(/[?#]/, 1)[0].toLowerCase();
  const asJson = pathOnly.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (asJson) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${location}: spec is not valid JSON (${message})`);
    }
  }

  let docs;
  try {
    docs = parseAllDocuments(body, { uniqueKeys: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${location}: spec is not valid YAML (${message})`);
  }
  if (docs.length !== 1) throw new Error(`${location}: expected a single YAML document`);
  const first = docs[0];
  if (first.errors.length > 0) {
    throw new Error(`${location}: spec is not valid YAML (${first.errors[0].message})`);
  }
  return first.toJS({ maxAliasCount: 50 });
}

function readVersion(doc: Record<string, unknown>, location: string): string {
  if (!Object.prototype.hasOwnProperty.call(doc, "openapi")) {
    if ("swagger" in doc) {
      throw new Error(
        `${location}: swagger ${show(doc.swagger)} is not supported, need OpenAPI 3.x`,
      );
    }
    throw new Error(`${location}: missing openapi version (need 3.x)`);
  }
  const version = normalizeVersion(doc.openapi);
  if (!version || !/^3\.\d+(\.\d+)?$/.test(version)) {
    throw new Error(`${location}: openapi version ${JSON.stringify(doc.openapi)} is not 3.x`);
  }
  return version;
}

function normalizeVersion(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // YAML reads an unquoted 3.0 as the number 3, and 3.1 as 3.1.
    if (Number.isInteger(raw)) return `${raw}.0`;
    return String(raw);
  }
  return undefined;
}

function readOperations(doc: Record<string, unknown>, location: string): OpenApiOperation[] {
  return listOperations(doc, location).map((operation) => {
    const entry: OpenApiOperation = { method: operation.method, path: operation.path };
    if (operation.operationId !== undefined) entry.operationId = operation.operationId;
    return entry;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}
