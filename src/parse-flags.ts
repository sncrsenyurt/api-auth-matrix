export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type HeaderLine = {
  name: string;
  value: string;
};

export type CliFlags = {
  spec: string;
  baseUrl: string;
  rolesPath: string;
  policyPath: string;
  headers: HeaderLine[];
  outDir: string;
  timeoutMs: number;
};

export const DEFAULT_OUT_DIR = "./auth-matrix-out";
export const DEFAULT_TIMEOUT_MS = 30000;

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function helpText(): string {
  return [
    "usage: api-auth-matrix <spec> --base-url <url> --roles <file> --policy <file>",
    "",
    "  <spec>              OpenAPI 3 document, a file path or an http(s) url",
    "  --base-url <url>    base url of the api under test",
    "  --roles <file>      role headers and cookies",
    "  --policy <file>     expected access per operation",
    "  --header <Name: v>  extra header, can be repeated",
    "  --out <dir>         output directory (default ./auth-matrix-out)",
    "  --timeout <ms>      request timeout in milliseconds (default 30000)",
    "  -h, --help          show this help",
  ].join("\n");
}

export function isHelpRequest(argv: string[]): boolean {
  return argv.some((arg) => arg === "-h" || arg === "--help" || arg.startsWith("--help="));
}

export function parseFlags(argv: string[]): CliFlags {
  let spec: string | undefined;
  let baseUrl: string | undefined;
  let rolesPath: string | undefined;
  let policyPath: string | undefined;
  let outDir: string | undefined;
  let timeoutMs: number | undefined;
  const headers: HeaderLine[] = [];
  const seen = new Set<string>();

  const take = (flag: string, inline: string | undefined, index: { i: number }): string => {
    if (inline !== undefined) {
      if (inline === "") throw new UsageError(`${flag} needs a value`);
      return inline;
    }
    const next = argv[index.i + 1];
    if (next === undefined || next.startsWith("-")) {
      throw new UsageError(`${flag} needs a value`);
    }
    index.i += 1;
    return next;
  };

  const once = (flag: string) => {
    if (seen.has(flag)) throw new UsageError(`${flag} given more than once`);
    seen.add(flag);
  };

  const index = { i: 0 };
  for (; index.i < argv.length; index.i += 1) {
    const arg = argv[index.i];

    if (arg === "--") {
      for (const rest of argv.slice(index.i + 1)) {
        if (spec !== undefined) throw new UsageError(`unexpected argument ${rest}`);
        spec = rest;
      }
      break;
    }

    if (arg.startsWith("-")) {
      const eq = arg.indexOf("=");
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);

      switch (flag) {
        case "--base-url":
          once(flag);
          baseUrl = take(flag, inline, index).trim();
          break;
        case "--roles":
          once(flag);
          rolesPath = take(flag, inline, index).trim();
          break;
        case "--policy":
          once(flag);
          policyPath = take(flag, inline, index).trim();
          break;
        case "--out":
          once(flag);
          outDir = take(flag, inline, index).trim();
          break;
        case "--timeout":
          once(flag);
          timeoutMs = parseTimeout(take(flag, inline, index).trim());
          break;
        case "--header":
          headers.push(parseHeader(take(flag, inline, index)));
          break;
        case "--help":
        case "-h":
          throw new UsageError("use --help on its own");
        default:
          throw new UsageError(`unknown flag ${flag}`);
      }
      continue;
    }

    if (spec !== undefined) throw new UsageError(`unexpected argument ${arg}`);
    spec = arg;
  }

  if (!spec) throw new UsageError("missing OpenAPI spec path or url");
  if (!baseUrl) throw new UsageError("missing --base-url");
  if (!rolesPath) throw new UsageError("missing --roles");
  if (!policyPath) throw new UsageError("missing --policy");
  if (outDir !== undefined && outDir.length === 0) throw new UsageError("--out needs a value");

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new UsageError(`--base-url is not a url: ${baseUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UsageError("--base-url must be http or https");
  }

  return {
    spec,
    baseUrl,
    rolesPath,
    policyPath,
    headers,
    outDir: outDir ?? DEFAULT_OUT_DIR,
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

function parseTimeout(raw: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new UsageError("--timeout must be a positive integer (milliseconds)");
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new UsageError("--timeout must be a positive integer (milliseconds)");
  }
  return n;
}

function parseHeader(raw: string): HeaderLine {
  const colon = raw.indexOf(":");
  if (colon <= 0) throw new UsageError('--header must look like "Name: value"');
  const name = raw.slice(0, colon).trim();
  const value = raw.slice(colon + 1).trim();
  if (!name) throw new UsageError("--header is missing a name");
  if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
    throw new UsageError("--header cannot contain a newline");
  }
  if (!HEADER_NAME.test(name)) throw new UsageError(`--header name is not valid: ${name}`);
  return { name, value };
}
