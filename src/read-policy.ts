import { readFile } from "node:fs/promises";
import { parseAllDocuments } from "yaml";

const ALLOWED_FIELDS = new Set(["allow", "resources"]);
const RESOURCE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const PARAM_NAME = /^[A-Za-z0-9_.-]+$/;

export type PolicyOperation = {
  key: string;
  allow?: string[];
  resources: Record<string, string>;
};

export async function loadPolicy(filePath: string): Promise<PolicyOperation[]> {
  const text = await readPolicyText(filePath);
  const parsed = parsePolicyFile(text, filePath);
  if (!isRecord(parsed)) throw new Error(`${filePath}: policy file must be a mapping of operations`);

  const operations: PolicyOperation[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key.trim().length === 0) throw new Error(`${filePath}: policy operation key is empty`);
    operations.push(readOperation(filePath, key, value));
  }
  return operations;
}

export function findPolicy(
  operations: PolicyOperation[],
  method: string,
  path: string,
  operationId?: string,
): PolicyOperation | undefined {
  if (operationId) {
    const byId = operations.find((operation) => operation.key === operationId);
    if (byId) return byId;
  }
  const label = `${method.toUpperCase()} ${path}`;
  return operations.find((operation) => operation.key.toLowerCase() === label.toLowerCase());
}

async function readPolicyText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`policy file not found: ${filePath}`);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read policy file ${filePath}: ${message}`);
  }
}

function parsePolicyFile(text: string, filePath: string): unknown {
  const body = text.replace(/^\uFEFF/, "");
  const trimmed = body.trim();
  if (!trimmed) throw new Error(`${filePath}: policy file is empty`);

  const asJson = filePath.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (asJson) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${filePath}: policy file is not valid JSON (${message})`);
    }
  }

  let docs;
  try {
    docs = parseAllDocuments(body, { uniqueKeys: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${filePath}: policy file is not valid YAML (${message})`);
  }
  if (docs.length === 0) throw new Error(`${filePath}: policy file is empty`);
  if (docs.length !== 1) throw new Error(`${filePath}: expected a single YAML document`);
  const first = docs[0];
  if (first.errors.length > 0) {
    throw new Error(`${filePath}: policy file is not valid YAML (${first.errors[0].message})`);
  }
  return first.toJS({ maxAliasCount: 20 });
}

function readOperation(filePath: string, key: string, value: unknown): PolicyOperation {
  if (value === null) return { key, resources: {} };
  if (!isRecord(value)) throw new Error(`${filePath}: operation "${key}" must be a mapping`);

  const unknown = Object.keys(value).filter((field) => !ALLOWED_FIELDS.has(field));
  if (unknown.length > 0) {
    const noun = unknown.length === 1 ? "key" : "keys";
    const listed = unknown.map((field) => JSON.stringify(field)).join(", ");
    throw new Error(
      `${filePath}: operation "${key}" has unknown ${noun} ${listed} (allowed: allow, resources)`,
    );
  }

  const operation: PolicyOperation = {
    key,
    resources: readResourceMap(filePath, key, value.resources),
  };
  const allow = readAllow(filePath, key, value.allow);
  if (allow) operation.allow = allow;
  return operation;
}

function readAllow(filePath: string, key: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${filePath}: operation "${key}": allow must be a list of role names`);
  }
  return value;
}

function readResourceMap(filePath: string, key: string, value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${filePath}: operation "${key}": resources must be a mapping`);

  const out: Record<string, string> = {};
  for (const [param, raw] of Object.entries(value)) {
    if (!PARAM_NAME.test(param)) {
      throw new Error(`${filePath}: operation "${key}": parameter name is not valid: ${JSON.stringify(param)}`);
    }
    if (typeof raw !== "string" || !RESOURCE_NAME.test(raw)) {
      throw new Error(`${filePath}: operation "${key}": resources.${param} must name a resource`);
    }
    out[param] = raw;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
