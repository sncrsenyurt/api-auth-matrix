import { deepResolve, resolveLocalRef } from "./resolve-ref.js";

const METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

const PLACES = new Set(["path", "query", "header", "cookie"]);

export type OperationParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  style?: string;
  explode?: boolean;
  example?: unknown;
  schema?: unknown;
};

export type OperationBody = {
  required: boolean;
  contentType: string;
  example?: unknown;
  schema?: unknown;
};

export type ListedOperation = {
  method: string;
  path: string;
  operationId?: string;
  parameters: OperationParameter[];
  body?: OperationBody;
};

export function listOperations(doc: Record<string, unknown>, location = "spec"): ListedOperation[] {
  if (!("paths" in doc) || doc.paths === undefined) return [];
  if (!isRecord(doc.paths)) throw new Error(`${location}: paths must be a mapping`);

  const operations: ListedOperation[] = [];
  for (const [path, rawItem] of Object.entries(doc.paths)) {
    if (path.startsWith("x-")) continue;
    const item = resolveLocalRef(doc, rawItem);
    if (!isRecord(item)) throw new Error(`${location}: path ${path} is not a mapping`);

    const pathParameters = readParameters(doc, item.parameters, location, path);
    for (const [key, rawOperation] of Object.entries(item)) {
      if (!METHODS.has(key)) continue;
      const operation = resolveLocalRef(doc, rawOperation);
      if (operation === undefined || operation === null) continue;
      if (!isRecord(operation)) {
        throw new Error(`${location}: ${key.toUpperCase()} ${path} is not a mapping`);
      }
      const operationId = operation.operationId;
      if (operationId !== undefined && typeof operationId !== "string") {
        throw new Error(`${location}: ${key.toUpperCase()} ${path} operationId is not a string`);
      }
      const ownParameters = readParameters(doc, operation.parameters, location, `${key.toUpperCase()} ${path}`);
      const listed: ListedOperation = {
        method: key,
        path,
        parameters: mergeParameters(pathParameters, ownParameters),
      };
      if (typeof operationId === "string") listed.operationId = operationId;
      const body = readBody(doc, operation.requestBody, location, `${key.toUpperCase()} ${path}`);
      if (body) listed.body = body;
      operations.push(listed);
    }
  }
  return operations;
}

function readParameters(
  doc: Record<string, unknown>,
  raw: unknown,
  location: string,
  where: string,
): OperationParameter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${location}: ${where} parameters must be a list`);
  return raw.map((entry) => readParameter(doc, entry, location, where));
}

function readParameter(
  doc: Record<string, unknown>,
  raw: unknown,
  location: string,
  where: string,
): OperationParameter {
  const resolved = deepResolve(doc, resolveLocalRef(doc, raw));
  if (!isRecord(resolved)) throw new Error(`${location}: ${where} parameter is not a mapping`);
  const name = resolved.name;
  const place = resolved.in;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${location}: ${where} parameter is missing a name`);
  }
  if (typeof place !== "string" || !PLACES.has(place)) {
    throw new Error(`${location}: ${where} parameter ${name} has an unsupported location`);
  }
  const parameter: OperationParameter = {
    name,
    in: place as OperationParameter["in"],
    required: place === "path" ? true : resolved.required === true,
  };
  if (typeof resolved.style === "string") parameter.style = resolved.style;
  if (typeof resolved.explode === "boolean") parameter.explode = resolved.explode;
  if ("example" in resolved) parameter.example = resolved.example;
  if ("schema" in resolved) parameter.schema = resolved.schema;
  return parameter;
}

function readBody(
  doc: Record<string, unknown>,
  raw: unknown,
  location: string,
  where: string,
): OperationBody | undefined {
  if (raw === undefined) return undefined;
  const resolved = deepResolve(doc, resolveLocalRef(doc, raw));
  if (!isRecord(resolved)) throw new Error(`${location}: ${where} request body is not a mapping`);
  const content = resolved.content;
  if (!isRecord(content)) return undefined;
  const picked = pickContent(content);
  if (!picked) return undefined;
  const body: OperationBody = {
    required: resolved.required === true,
    contentType: picked.contentType,
  };
  const example = mediaExample(picked.media);
  if (example !== undefined) body.example = example;
  if (isRecord(picked.media.schema)) body.schema = picked.media.schema;
  return body;
}

function pickContent(
  content: Record<string, unknown>,
): { contentType: string; media: Record<string, unknown> } | undefined {
  const preferred = ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];
  for (const type of preferred) {
    if (isRecord(content[type])) return { contentType: type, media: content[type] };
  }
  for (const [type, media] of Object.entries(content)) {
    if (type.endsWith("+json") && isRecord(media)) return { contentType: type, media };
  }
  for (const [type, media] of Object.entries(content)) {
    if (isRecord(media)) return { contentType: type, media };
  }
  return undefined;
}

function mediaExample(media: Record<string, unknown>): unknown {
  if ("example" in media) return media.example;
  if (!isRecord(media.examples)) return undefined;
  for (const entry of Object.values(media.examples)) {
    if (isRecord(entry) && "value" in entry) return entry.value;
  }
  return undefined;
}

function mergeParameters(base: OperationParameter[], extra: OperationParameter[]): OperationParameter[] {
  const merged = [...base];
  for (const parameter of extra) {
    const index = merged.findIndex((item) => item.name === parameter.name && item.in === parameter.in);
    if (index === -1) merged.push(parameter);
    else merged[index] = parameter;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
