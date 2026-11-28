#!/usr/bin/env node
import { comparePolicy, formatMismatch } from "./compare-policy.js";
import { helpText, isHelpRequest, parseFlags, UsageError } from "./parse-flags.js";
import { listOperations } from "./list-operations.js";
import { loadOpenApi } from "./read-openapi.js";
import { loadPolicy } from "./read-policy.js";
import { loadRoles } from "./read-roles.js";
import { runMatrix } from "./run-matrix.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (isHelpRequest(argv)) {
    console.log(helpText());
    return;
  }

  const flags = parseFlags(argv);
  const spec = await loadOpenApi(flags.spec);
  const roles = await loadRoles(flags.rolesPath);
  const policy = await loadPolicy(flags.policyPath);
  const matrix = await runMatrix({
    operations: listOperations(spec.document, flags.spec),
    roles,
    policy,
    baseUrl: flags.baseUrl,
    timeoutMs: flags.timeoutMs,
    extraHeaders: flags.headers,
  });

  const headerCount = flags.headers.length;
  const headerNote = headerCount === 1 ? "1 extra header" : `${headerCount} extra headers`;
  console.log(
    `openapi ${spec.version} at ${visibleBase(flags.baseUrl)}, ${matrix.operations.length} operations, ${matrix.roles.length} roles, ${headerNote}, timeout ${flags.timeoutMs}ms, out ${flags.outDir}`,
  );
  const mismatches = comparePolicy(matrix, policy);
  if (mismatches.length === 0) {
    console.log("no mismatches");
    return;
  }
  for (const mismatch of mismatches) console.log(formatMismatch(mismatch));
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
