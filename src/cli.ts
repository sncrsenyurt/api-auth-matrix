#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { helpText, isHelpRequest, parseFlags, UsageError } from "./parse-flags.js";
import { loadOpenApi } from "./read-openapi.js";
import { loadRoles } from "./read-roles.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (isHelpRequest(argv)) {
    console.log(helpText());
    return;
  }

  const flags = parseFlags(argv);
  const spec = await loadOpenApi(flags.spec);
  const roles = await loadRoles(flags.rolesPath);
  await assertPolicyFile(flags.policyPath);

  const headerCount = flags.headers.length;
  const headerNote = headerCount === 1 ? "1 extra header" : `${headerCount} extra headers`;
  console.log(
    `openapi ${spec.version} at ${visibleBase(flags.baseUrl)}, ${spec.operations.length} operations, ${roles.length} roles, ${headerNote}, timeout ${flags.timeoutMs}ms, out ${flags.outDir}`,
  );
}

function visibleBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  if (url.pathname === "/") return url.origin;
  return `${url.origin}${url.pathname}`;
}

async function assertPolicyFile(policyPath: string): Promise<void> {
  let info;
  try {
    info = await stat(policyPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`policy file not found: ${policyPath}`);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read policy file ${policyPath}: ${message}`);
  }
  if (!info.isFile()) throw new Error(`policy path is not a file: ${policyPath}`);
}

main().then(
  () => {
    process.exit(0);
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    if (err instanceof UsageError) console.error("run with --help for usage");
    process.exit(1);
  },
);
