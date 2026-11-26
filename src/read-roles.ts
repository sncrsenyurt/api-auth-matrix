import { readFile } from "node:fs/promises";
import { parseAllDocuments } from "yaml";

const ROLE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FIELD_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALLOWED_FIELDS = new Set(["headers", "cookies", "resources"]);
const RESOURCE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export type RoleAuth = {
  name: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  resources: Record<string, string>;
};

export async function loadRoles(
  filePath: string,
  env: Record<string, string | undefined> = process.env,
): Promise<RoleAuth[]> {
  const text = await readRolesText(filePath);
  const parsed = parseRolesFile(text, filePath);
  if (!isRecord(parsed)) {
    throw new Error(`${filePath}: roles file must be a mapping of role names`);
  }

  const roles: RoleAuth[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (!ROLE_NAME.test(name)) throw new Error(`${filePath}: invalid role name ${JSON.stringify(name)}`);
    roles.push(readRole(filePath, name, value, env));
  }
  return roles;
}

async function readRolesText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`roles file not found: ${filePath}`);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read roles file ${filePath}: ${message}`);
  }
}

function parseRolesFile(text: string, filePath: string): unknown {
  const body = text.replace(/^\uFEFF/, "");
  const trimmed = body.trim();
  if (!trimmed) throw new Error(`${filePath}: roles file is empty`);

  const asJson = filePath.toLowerCase().endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (asJson) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${filePath}: roles file is not valid JSON (${message})`);
    }
  }

  let docs;
  try {
    docs = parseAllDocuments(body, { uniqueKeys: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${filePath}: roles file is not valid YAML (${message})`);
  }
  if (docs.length === 0) throw new Error(`${filePath}: roles file is empty`);
  if (docs.length !== 1) throw new Error(`${filePath}: expected a single YAML document`);
  const first = docs[0];
  if (first.errors.length > 0) {
    throw new Error(`${filePath}: roles file is not valid YAML (${first.errors[0].message})`);
  }
  return first.toJS({ maxAliasCount: 20 });
}

function readRole(
  filePath: string,
  name: string,
  value: unknown,
  env: Record<string, string | undefined>,
): RoleAuth {
  if (value === null) return { name, headers: {}, cookies: {}, resources: {} };
  if (!isRecord(value)) throw new Error(`${filePath}: role "${name}" must be a mapping`);

  const unknown = Object.keys(value).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length > 0) {
    const noun = unknown.length === 1 ? "key" : "keys";
    const listed = unknown.map((key) => JSON.stringify(key)).join(", ");
    throw new Error(
      `${filePath}: role "${name}" has unknown ${noun} ${listed} (allowed: headers, cookies, resources)`,
    );
  }

  return {
    name,
    headers: readField(filePath, name, "headers", value.headers, env),
    cookies: readField(filePath, name, "cookies", value.cookies, env),
    resources: readResources(filePath, name, value.resources, env),
  };
}

function readField(
  filePath: string,
  role: string,
  field: "headers" | "cookies",
  value: unknown,
  env: Record<string, string | undefined>,
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${filePath}: role "${role}": ${field} must be a mapping`);
  }

  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!FIELD_NAME.test(key)) {
      throw new Error(`${filePath}: role "${role}": ${field} name is not valid: ${JSON.stringify(key)}`);
    }
    if (typeof raw !== "string") {
      throw new Error(`${filePath}: role "${role}": ${field}.${key} must be a string`);
    }
    out[key] = fillPlaceholders(raw, `${filePath}: role "${role}": ${field}.${key}`, env);
  }
  return out;
}

function readResources(
  filePath: string,
  role: string,
  value: unknown,
  env: Record<string, string | undefined>,
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${filePath}: role "${role}": resources must be a mapping`);

  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!RESOURCE_NAME.test(key)) {
      throw new Error(`${filePath}: role "${role}": resource name is not valid: ${JSON.stringify(key)}`);
    }
    const where = `${filePath}: role "${role}": resources.${key}`;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = String(raw);
      continue;
    }
    if (typeof raw !== "string") throw new Error(`${where} must be a string`);
    out[key] = fillPlaceholders(raw, where, env);
  }
  return out;
}

function fillPlaceholders(value: string, where: string, env: Record<string, string | undefined>): string {
  const withoutClosed = value.replace(/\$\{[^}]*\}/g, "");
  if (withoutClosed.includes("${")) throw new Error(`${where}: unclosed placeholder`);

  const bad: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(/\$\{([^}]*)\}/g)) {
    const inner = match[1] ?? "";
    if (!ENV_NAME.test(inner)) {
      bad.push(inner);
      continue;
    }
    // unset is an error; a defined empty string is a real value
    if (env[inner] === undefined && !seen.has(inner)) {
      seen.add(inner);
      missing.push(inner);
    }
  }
  if (bad.length > 0) throw new Error(`${where}: bad placeholder \${${bad[0]}}`);
  if (missing.length > 0) {
    const names = missing.map((name) => `\${${name}}`).join(", ");
    throw new Error(`${where}: missing environment variable ${names}`);
  }

  return value.replace(/\$\{([^}]*)\}/g, (_whole, name: string) => env[name] ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
