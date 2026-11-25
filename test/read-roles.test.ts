import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRoles } from "../src/read-roles.js";

const basic = path.join("test", "fixtures", "roles.basic.yaml");

const env = {
  USER_TOKEN: "user-token-value",
  ADMIN_TOKEN: "admin-token-value",
  ADMIN_SESSION: "admin-session-value",
  OTHER_USER_TOKEN: "other-token-value",
  EXPIRED_TOKEN: "expired-token-value",
};

describe("loadRoles", () => {
  it("loads the sample roles and fills placeholders", async () => {
    const roles = await loadRoles(basic, env);
    expect(roles.map((role) => role.name)).toEqual([
      "anonymous",
      "user",
      "admin",
      "other_user",
      "expired",
    ]);
    expect(roles[0]).toEqual({ name: "anonymous", headers: {}, cookies: {} });
    expect(roles[1].headers).toEqual({ Authorization: "Bearer user-token-value" });
    expect(roles[1].cookies).toEqual({});
    expect(roles[2].headers).toEqual({ Authorization: "Bearer admin-token-value" });
    expect(roles[2].cookies).toEqual({ session: "admin-session-value" });
    expect(roles[3].headers.Authorization).toBe("Bearer other-token-value");
    expect(roles[4].headers.Authorization).toBe("Bearer expired-token-value");
  });

  it("treats a null role and an empty string env var as empty auth", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const file = path.join(dir, "roles.yaml");
    await writeFile(
      file,
      "anonymous:\ngarbage:\n  headers:\n    Authorization: Bearer ${USER_TOKEN}\n",
    );
    const roles = await loadRoles(file, { USER_TOKEN: "" });
    expect(roles).toEqual([
      { name: "anonymous", headers: {}, cookies: {} },
      { name: "garbage", headers: { Authorization: "Bearer " }, cookies: {} },
    ]);
  });

  it("keeps a literal header that has no placeholder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const file = path.join(dir, "roles.yaml");
    await writeFile(file, "expired:\n  headers:\n    Authorization: Bearer not-a-token\n");
    const roles = await loadRoles(file, {});
    expect(roles[0].headers.Authorization).toBe("Bearer not-a-token");
  });

  it("reads a json roles file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const file = path.join(dir, "roles.json");
    await writeFile(
      file,
      JSON.stringify({
        user: { headers: { Authorization: "Bearer ${USER_TOKEN}" } },
      }),
    );
    const roles = await loadRoles(file, { USER_TOKEN: "user-token-value" });
    expect(roles[0].headers.Authorization).toBe("Bearer user-token-value");
  });

  it("uses process.env when no env map is passed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const file = path.join(dir, "roles.yaml");
    await writeFile(file, "user:\n  headers:\n    X-Test: ${API_AUTH_MATRIX_TEST_TOKEN}\n");
    const key = "API_AUTH_MATRIX_TEST_TOKEN";
    const previous = process.env[key];
    process.env[key] = "from-process-env";
    try {
      const roles = await loadRoles(file);
      expect(roles[0].headers["X-Test"]).toBe("from-process-env");
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it("names unknown keys and does not accept a string role", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const one = path.join(dir, "one.yaml");
    const two = path.join(dir, "two.yaml");
    const bad = path.join(dir, "bad.yaml");
    await writeFile(one, "user:\n  token: nope\n  headers:\n    Authorization: x\n");
    await writeFile(two, "user:\n  token: nope\n  query: also\n");
    await writeFile(bad, "user: admin\n");
    await expect(loadRoles(one, {})).rejects.toThrow(
      /role "user" has unknown key "token" \(allowed: headers, cookies\)/,
    );
    await expect(loadRoles(two, {})).rejects.toThrow(
      /role "user" has unknown keys "token", "query" \(allowed: headers, cookies\)/,
    );
    await expect(loadRoles(bad, {})).rejects.toThrow(/role "user" must be a mapping/);
  });

  it("reports a missing env var without echoing other values", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const file = path.join(dir, "roles.yaml");
    await writeFile(
      file,
      [
        "user:",
        "  headers:",
        "    Authorization: Bearer ${USER_TOKEN}",
        "admin:",
        "  headers:",
        "    Authorization: Bearer ${ADMIN_TOKEN}",
        "",
      ].join("\n"),
    );
    const given = { ADMIN_TOKEN: "admin-secret-value" };
    await expect(loadRoles(file, given)).rejects.toThrow(
      /role "user": headers\.Authorization: missing environment variable \$\{USER_TOKEN\}/,
    );
    try {
      await loadRoles(file, given);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain("admin-secret-value");
      expect(message).not.toContain("Bearer");
    }
  });

  it("reports every missing name once, and rejects a bad or unclosed placeholder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const missing = path.join(dir, "missing.yaml");
    const bad = path.join(dir, "bad.yaml");
    const open = path.join(dir, "open.yaml");
    await writeFile(
      missing,
      "user:\n  headers:\n    Authorization: ${USER_TOKEN} ${USER_TOKEN} ${OTHER_USER_TOKEN}\n",
    );
    await writeFile(bad, "user:\n  headers:\n    Authorization: ${USER-TOKEN}\n");
    await writeFile(open, "user:\n  headers:\n    Authorization: Bearer ${USER_TOKEN\n");
    await expect(loadRoles(missing, {})).rejects.toThrow(
      /missing environment variable \$\{USER_TOKEN\}, \$\{OTHER_USER_TOKEN\}/,
    );
    await expect(loadRoles(bad, {})).rejects.toThrow(/bad placeholder \$\{USER-TOKEN\}/);
    await expect(loadRoles(open, {})).rejects.toThrow(/unclosed placeholder/);
  });

  it("rejects a non-string header, a list of headers, a bad role name, and a missing file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const number = path.join(dir, "number.yaml");
    const list = path.join(dir, "list.yaml");
    const name = path.join(dir, "name.yaml");
    const array = path.join(dir, "array.yaml");
    await writeFile(number, "user:\n  headers:\n    Authorization: 123\n");
    await writeFile(list, "user:\n  headers:\n    - Authorization\n");
    await writeFile(name, '"bad name": {}\n');
    await writeFile(array, "- user\n");
    await expect(loadRoles(number, {})).rejects.toThrow(/headers\.Authorization must be a string/);
    await expect(loadRoles(list, {})).rejects.toThrow(/headers must be a mapping/);
    await expect(loadRoles(name, {})).rejects.toThrow(/invalid role name/);
    await expect(loadRoles(array, {})).rejects.toThrow(/must be a mapping of role names/);
    await expect(loadRoles(path.join(dir, "nope.yaml"), {})).rejects.toThrow(/roles file not found/);
  });

  it("rejects duplicate keys and an empty file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    const dup = path.join(dir, "dup.yaml");
    const empty = path.join(dir, "empty.yaml");
    await writeFile(dup, "user: {}\nuser:\n  headers:\n    Authorization: x\n");
    await writeFile(empty, "# nothing to see\n");
    await expect(loadRoles(dup, {})).rejects.toThrow(/not valid YAML/);
    await expect(loadRoles(empty, {})).rejects.toThrow(/roles file is empty/);
  });
});
