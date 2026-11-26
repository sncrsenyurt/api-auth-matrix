const REF = "$ref";

export function resolveLocalRef(root: unknown, node: unknown): unknown {
  return followRef(root, node, []);
}

export function deepResolve(root: unknown, node: unknown): unknown {
  return walk(root, node, []);
}

function followRef(root: unknown, node: unknown, stack: string[]): unknown {
  if (!isRecord(node) || typeof node[REF] !== "string") return node;
  const ref = node[REF].trim();
  const target = readTarget(root, ref, stack);
  const resolved = followRef(root, target, [...stack, ref]);
  return overlaySiblings(root, resolved, node);
}

function walk(root: unknown, node: unknown, stack: string[]): unknown {
  if (Array.isArray(node)) return node.map((item) => walk(root, item, stack));
  if (!isRecord(node)) return node;

  if (typeof node[REF] === "string") {
    const ref = node[REF].trim();
    if (stack.includes(ref)) return {};
    const target = readTarget(root, ref, stack);
    const resolved = walk(root, target, [...stack, ref]);
    return overlaySiblings(root, resolved, node, [...stack, ref]);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = walk(root, value, stack);
  }
  return out;
}

function readTarget(root: unknown, ref: string, stack: string[]): unknown {
  if (stack.includes(ref)) throw new Error(`circular $ref ${ref}`);
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) throw new Error(`external $ref is not supported: ${ref}`);
  const parts = ref.slice(2).split("/").map(decodePointer);
  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current) && /^[0-9]+$/.test(part)) {
      const index = Number(part);
      if (index >= current.length) throw new Error(`$ref not found: ${ref}`);
      current = current[index];
      continue;
    }
    if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
      continue;
    }
    throw new Error(`$ref not found: ${ref}`);
  }
  return current;
}

function overlaySiblings(
  root: unknown,
  resolved: unknown,
  source: Record<string, unknown>,
  stack?: string[],
): unknown {
  const siblings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key !== REF) siblings[key] = value;
  }
  if (Object.keys(siblings).length === 0) return resolved;
  if (!isRecord(resolved) || ignoresSiblings(root)) return resolved;
  if (!stack) return { ...resolved, ...siblings };
  const out: Record<string, unknown> = { ...resolved };
  for (const [key, value] of Object.entries(siblings)) {
    out[key] = walk(root, value, stack);
  }
  return out;
}

function ignoresSiblings(root: unknown): boolean {
  if (!isRecord(root)) return true;
  const version = root.openapi;
  if (typeof version === "string") return version.startsWith("3.0");
  if (typeof version === "number") return version < 3.1;
  return true;
}

function decodePointer(part: string): string {
  // ~1 first, otherwise ~01 becomes the wrong character
  return part.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
