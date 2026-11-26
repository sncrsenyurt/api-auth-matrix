import type { ListedOperation, OperationBody, OperationParameter } from "./list-operations.js";

export type QueryPair = {
  name: string;
  value: string;
};

export type BuiltRequest = {
  method: string;
  path: string;
  query: QueryPair[];
  headers: Record<string, string>;
  cookies: Record<string, string>;
  body?: unknown;
  contentType?: string;
};

type Sample = { has: true; value: unknown } | { has: false };

export function buildRequest(
  operation: ListedOperation,
  resources: Record<string, string> = {},
  parameterResources: Record<string, string> = {},
): BuiltRequest {
  const where = `${operation.method.toUpperCase()} ${operation.path}`;
  const pathValues: Record<string, string> = {};
  const query: QueryPair[] = [];
  const headers: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  for (const parameter of operation.parameters) {
    const value = valueForParameter(parameter, resources, parameterResources, where);
    if (value === undefined) continue;
    if (parameter.in === "path") {
      pathValues[parameter.name] = scalar(value, `path parameter ${parameter.name}`, where);
      continue;
    }
    if (parameter.in === "header") {
      headers[parameter.name] = scalar(value, `header parameter ${parameter.name}`, where);
      continue;
    }
    if (parameter.in === "cookie") {
      cookies[parameter.name] = scalar(value, `cookie parameter ${parameter.name}`, where);
      continue;
    }
    query.push(...queryPairs(parameter, value, where));
  }

  const request: BuiltRequest = {
    method: operation.method,
    path: fillPath(operation.path, pathValues, where),
    query,
    headers,
    cookies,
  };

  if (operation.body) {
    const body = valueForBody(operation.body, resources, parameterResources, where);
    if (body !== undefined) {
      request.body = body;
      request.contentType = operation.body.contentType;
    } else if (operation.body.required) {
      throw new Error(`cannot fill request body for ${where}`);
    }
  }

  return request;
}

function valueForParameter(
  parameter: OperationParameter,
  resources: Record<string, string>,
  parameterResources: Record<string, string>,
  where: string,
): unknown | undefined {
  const fromResource = lookupResource(parameter.name, resources, parameterResources);
  if (fromResource !== undefined) return fromResource;
  if (parameter.example !== undefined) return parameter.example;
  if (parameter.schema !== undefined) {
    const sampled = sampleSchema(parameter.schema, undefined, resources, parameterResources, where, 0);
    if (sampled.has) return sampled.value;
  }
  if (parameter.required) {
    throw new Error(`cannot fill ${parameter.in} parameter ${parameter.name} for ${where}`);
  }
  return undefined;
}

function valueForBody(
  body: OperationBody,
  resources: Record<string, string>,
  parameterResources: Record<string, string>,
  where: string,
): unknown | undefined {
  if (body.example !== undefined) return overlayExample(body.example, body.schema, resources, parameterResources);
  if (body.schema !== undefined) {
    const sampled = sampleSchema(body.schema, undefined, resources, parameterResources, where, 0);
    if (sampled.has) return sampled.value;
  }
  return undefined;
}

function lookupResource(
  name: string,
  resources: Record<string, string>,
  parameterResources: Record<string, string>,
): string | undefined {
  const mapped = parameterResources[name];
  if (mapped !== undefined) {
    if (Object.prototype.hasOwnProperty.call(resources, mapped)) return resources[mapped];
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(resources, name)) return resources[name];
  return undefined;
}

function sampleSchema(
  schema: unknown,
  name: string | undefined,
  resources: Record<string, string>,
  parameterResources: Record<string, string>,
  where: string,
  depth: number,
): Sample {
  if (depth > 8 || !isRecord(schema)) return { has: false };
  const flat = flattenSchema(schema);
  if (name !== undefined) {
    const fromResource = lookupResource(name, resources, parameterResources);
    if (fromResource !== undefined) return { has: true, value: fromResource };
  }
  if (flat.example !== undefined) return { has: true, value: flat.example };
  if (flat.default !== undefined) return { has: true, value: flat.default };
  if ("const" in flat && flat.const !== undefined) return { has: true, value: flat.const };
  if (Array.isArray(flat.enum) && flat.enum.length > 0) return { has: true, value: flat.enum[0] };

  const type = typeof flat.type === "string" ? flat.type : undefined;
  if (type === "object" || isRecord(flat.properties)) {
    return sampleObject(flat, resources, parameterResources, where, depth);
  }
  if (type === "array" && flat.items !== undefined) {
    const item = sampleSchema(flat.items, undefined, resources, parameterResources, where, depth + 1);
    if (!item.has) return { has: false };
    return { has: true, value: [item.value] };
  }
  return { has: false };
}

function sampleObject(
  schema: Record<string, unknown>,
  resources: Record<string, string>,
  parameterResources: Record<string, string>,
  where: string,
  depth: number,
): Sample {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [],
  );
  const out: Record<string, unknown> = {};
  for (const [prop, propSchema] of Object.entries(properties)) {
    const sampled = sampleSchema(propSchema, prop, resources, parameterResources, where, depth + 1);
    if (!sampled.has) {
      if (required.has(prop)) throw new Error(`cannot fill required property ${prop} for ${where}`);
      continue;
    }
    out[prop] = sampled.value;
  }
  for (const prop of required) {
    if (!Object.prototype.hasOwnProperty.call(out, prop)) {
      throw new Error(`cannot fill required property ${prop} for ${where}`);
    }
  }
  return { has: true, value: out };
}

function flattenSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      if (isRecord(part)) parts.push(flattenSchema(part));
    }
  } else if (Array.isArray(schema.anyOf) && isRecord(schema.anyOf[0])) {
    parts.push(flattenSchema(schema.anyOf[0]));
  } else if (Array.isArray(schema.oneOf) && isRecord(schema.oneOf[0])) {
    parts.push(flattenSchema(schema.oneOf[0]));
  }

  let merged: Record<string, unknown> = {};
  for (const part of parts) merged = mergeSchema(merged, part);
  const local: Record<string, unknown> = { ...schema };
  delete local.allOf;
  delete local.anyOf;
  delete local.oneOf;
  return mergeSchema(merged, local);
}

function mergeSchema(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, ...extra };
  if (isRecord(base.properties) || isRecord(extra.properties)) {
    out.properties = {
      ...(isRecord(base.properties) ? base.properties : {}),
      ...(isRecord(extra.properties) ? extra.properties : {}),
    };
  }
  const required = [
    ...(Array.isArray(base.required) ? base.required : []),
    ...(Array.isArray(extra.required) ? extra.required : []),
  ].filter((item): item is string => typeof item === "string");
  if (required.length > 0) out.required = [...new Set(required)];
  return out;
}

function overlayExample(
  example: unknown,
  schema: unknown,
  resources: Record<string, string>,
  parameterResources: Record<string, string>,
): unknown {
  if (!isRecord(example) || !isRecord(schema)) return example;
  const flat = flattenSchema(schema);
  if (!isRecord(flat.properties)) return example;
  const out: Record<string, unknown> = { ...example };
  for (const prop of Object.keys(flat.properties)) {
    const fromResource = lookupResource(prop, resources, parameterResources);
    if (fromResource !== undefined) out[prop] = fromResource;
  }
  return out;
}

function queryPairs(parameter: OperationParameter, value: unknown, where: string): QueryPair[] {
  const style = parameter.style ?? "form";
  const explode = parameter.explode ?? style === "form";
  const label = `query parameter ${parameter.name}`;
  if (Array.isArray(value)) {
    const parts = value.map((item) => scalar(item, label, where));
    if (explode && style === "form") return parts.map((part) => ({ name: parameter.name, value: part }));
    return [{ name: parameter.name, value: parts.join(",") }];
  }
  return [{ name: parameter.name, value: scalar(value, label, where) }];
}

function fillPath(template: string, values: Record<string, string>, where: string): string {
  return template.replace(/\{([^{}]+)\}/g, (_whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`cannot fill path parameter ${name} for ${where}`);
    }
    return encodeURIComponent(values[name]);
  });
}

function scalar(value: unknown, label: string, where: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new Error(`${label} is not a scalar for ${where}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
