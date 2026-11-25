import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUT_DIR,
  DEFAULT_TIMEOUT_MS,
  UsageError,
  isHelpRequest,
  parseFlags,
} from "../src/parse-flags.js";

const base = [
  "./openapi.yaml",
  "--base-url",
  "http://127.0.0.1:3000",
  "--roles",
  "roles.yaml",
  "--policy",
  "policy.yaml",
];

describe("parseFlags", () => {
  it("fills defaults and keeps the spec path", () => {
    const flags = parseFlags(base);
    expect(flags).toEqual({
      spec: "./openapi.yaml",
      baseUrl: "http://127.0.0.1:3000",
      rolesPath: "roles.yaml",
      policyPath: "policy.yaml",
      headers: [],
      outDir: DEFAULT_OUT_DIR,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    expect(flags.outDir).toBe("./auth-matrix-out");
    expect(flags.timeoutMs).toBe(30000);
  });

  it("accepts equals form and repeated headers", () => {
    const flags = parseFlags([
      "https://example.com/openapi.json",
      "--base-url=https://api.example.com/v1",
      "--roles=./roles.yaml",
      "--policy=./policy.yaml",
      "--header",
      "X-Request-Id: abc",
      "--header=Accept: application/json",
      "--out",
      "out/run-1",
      "--timeout",
      "45000",
    ]);
    expect(flags.spec).toBe("https://example.com/openapi.json");
    expect(flags.baseUrl).toBe("https://api.example.com/v1");
    expect(flags.outDir).toBe("out/run-1");
    expect(flags.timeoutMs).toBe(45000);
    expect(flags.headers).toEqual([
      { name: "X-Request-Id", value: "abc" },
      { name: "Accept", value: "application/json" },
    ]);
  });

  it("keeps colons inside the header value", () => {
    const flags = parseFlags([...base, "--header", "Authorization: Bearer a:b"]);
    expect(flags.headers).toEqual([{ name: "Authorization", value: "Bearer a:b" }]);
  });

  it("stops flag parsing after --", () => {
    const flags = parseFlags([
      "--base-url",
      "http://localhost:9",
      "--roles",
      "roles.yaml",
      "--policy",
      "policy.yaml",
      "--",
      "./openapi.yaml",
    ]);
    expect(flags.spec).toBe("./openapi.yaml");
  });

  it("rejects a second positional", () => {
    expect(() => parseFlags([...base, "extra.yaml"])).toThrow(UsageError);
    expect(() => parseFlags([...base, "extra.yaml"])).toThrow(/unexpected argument extra.yaml/);
  });

  it("names the missing required piece", () => {
    expect(() => parseFlags([])).toThrow(/missing OpenAPI spec/);
    expect(() => parseFlags(["spec.yaml"])).toThrow(/missing --base-url/);
    expect(() => parseFlags(["spec.yaml", "--base-url", "http://localhost"])).toThrow(/missing --roles/);
    expect(() =>
      parseFlags(["spec.yaml", "--base-url", "http://localhost", "--roles", "roles.yaml"]),
    ).toThrow(/missing --policy/);
  });

  it("rejects unknown flags and bad timeout values", () => {
    expect(() => parseFlags([...base, "--nope"])).toThrow(/unknown flag --nope/);
    expect(() => parseFlags([...base, "-x"])).toThrow(/unknown flag -x/);
    expect(() => parseFlags([...base, "--timeout", "0"])).toThrow(/positive integer/);
    expect(() => parseFlags([...base, "--timeout", "10.5"])).toThrow(/positive integer/);
    expect(() => parseFlags([...base, "--timeout=abc"])).toThrow(/positive integer/);
    expect(() => parseFlags([...base, "--timeout=-5"])).toThrow(/positive integer/);
  });

  it("rejects a repeated single-value flag", () => {
    expect(() => parseFlags([...base, "--base-url", "http://localhost:1"])).toThrow(
      /--base-url given more than once/,
    );
  });

  it("rejects a base url that is not http(s)", () => {
    expect(() =>
      parseFlags(["spec.yaml", "--base-url", "ftp://files.example", "--roles", "r", "--policy", "p"]),
    ).toThrow(/http or https/);
    expect(() =>
      parseFlags(["spec.yaml", "--base-url", "not a url", "--roles", "r", "--policy", "p"]),
    ).toThrow(/not a url/);
  });

  it("rejects a header that has no name", () => {
    expect(() => parseFlags([...base, "--header", "nosep"])).toThrow(/Name: value/);
    expect(() => parseFlags([...base, "--header"])).toThrow(/--header needs a value/);
  });
});

describe("isHelpRequest", () => {
  it("spots -h and --help and ignores other args", () => {
    expect(isHelpRequest(["--help"])).toBe(true);
    expect(isHelpRequest(["-h"])).toBe(true);
    expect(isHelpRequest(["spec.yaml", "--help"])).toBe(true);
    expect(isHelpRequest(base)).toBe(false);
  });
});
