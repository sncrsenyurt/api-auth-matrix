import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOpenApi } from "../src/read-openapi.js";

const shopYaml = path.join("test", "fixtures", "shop.openapi.yaml");
const shopJson = path.join("test", "fixtures", "shop.openapi.json");

const shopOps = [
  { method: "get", path: "/items", operationId: "listItems" },
  { method: "post", path: "/items", operationId: "createItem" },
  { method: "get", path: "/items/{id}", operationId: "getItem" },
  { method: "delete", path: "/items/{id}" },
];

describe("loadOpenApi files", () => {
  it("reads a yaml spec and lists operations", async () => {
    const loaded = await loadOpenApi(shopYaml);
    expect(loaded.version).toBe("3.0.3");
    expect(loaded.operations).toEqual(shopOps);
    expect(loaded.document.info).toMatchObject({ title: "shop" });
  });

  it("reads the same spec as json", async () => {
    const loaded = await loadOpenApi(shopJson);
    expect(loaded.version).toBe("3.0.3");
    expect(loaded.operations).toEqual(shopOps);
  });

  it("accepts 3.1 and an unquoted 3.0", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spec-"));
    const threeOne = path.join(dir, "three-one.yaml");
    const threeOh = path.join(dir, "three-oh.yaml");
    await writeFile(threeOne, 'openapi: "3.1.0"\ninfo:\n  title: a\n  version: "1"\npaths: {}\n');
    await writeFile(threeOh, "openapi: 3.0\ninfo:\n  title: a\n  version: \"1\"\npaths: {}\n");
    expect((await loadOpenApi(threeOne)).version).toBe("3.1.0");
    expect((await loadOpenApi(threeOh)).version).toBe("3.0");
  });

  it("treats a missing paths map as no operations", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spec-"));
    const file = path.join(dir, "no-paths.yaml");
    await writeFile(file, 'openapi: "3.0.3"\ninfo:\n  title: a\n  version: "1"\n');
    const loaded = await loadOpenApi(file);
    expect(loaded.operations).toEqual([]);
  });

  it("rejects swagger, a non-3 version, and a non-mapping", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spec-"));
    const swagger = path.join(dir, "swagger.yaml");
    const old = path.join(dir, "old.yaml");
    const list = path.join(dir, "list.json");
    await writeFile(swagger, 'swagger: "2.0"\ninfo:\n  title: old\n  version: "1"\npaths: {}\n');
    await writeFile(old, 'openapi: "2.0"\ninfo:\n  title: old\n  version: "1"\npaths: {}\n');
    await writeFile(list, "[1, 2, 3]\n");
    await expect(loadOpenApi(swagger)).rejects.toThrow(/swagger 2.0 is not supported/);
    await expect(loadOpenApi(old)).rejects.toThrow(/not 3\.x/);
    await expect(loadOpenApi(list)).rejects.toThrow(/spec must be a mapping/);
  });

  it("rejects a missing version, broken yaml, and a missing file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spec-"));
    const bare = path.join(dir, "bare.yaml");
    const broken = path.join(dir, "broken.yaml");
    await writeFile(bare, "info:\n  title: a\n  version: \"1\"\npaths: {}\n");
    await writeFile(broken, "openapi: [\n");
    await expect(loadOpenApi(bare)).rejects.toThrow(/missing openapi version/);
    await expect(loadOpenApi(broken)).rejects.toThrow(/not valid YAML/);
    await expect(loadOpenApi(path.join(dir, "nope.yaml"))).rejects.toThrow(/spec file not found/);
  });

  it("rejects a path item that is not a mapping and a bad operationId", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spec-"));
    const badPath = path.join(dir, "bad-path.yaml");
    const badId = path.join(dir, "bad-id.yaml");
    await writeFile(badPath, 'openapi: "3.0.3"\npaths:\n  /items: just-a-string\n');
    await writeFile(
      badId,
      'openapi: "3.0.3"\npaths:\n  /items:\n    get:\n      operationId: 12\n',
    );
    await expect(loadOpenApi(badPath)).rejects.toThrow(/path \/items is not a mapping/);
    await expect(loadOpenApi(badId)).rejects.toThrow(/operationId is not a string/);
  });

  it("rejects duplicate keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "spec-"));
    const file = path.join(dir, "dup.yaml");
    await writeFile(file, 'openapi: "3.0.3"\nopenapi: "3.1.0"\npaths: {}\n');
    await expect(loadOpenApi(file)).rejects.toThrow(/not valid YAML/);
  });
});

describe("loadOpenApi urls", () => {
  it("loads yaml from an http url", async () => {
    const body = await readFile(shopYaml, "utf8");
    const { url, close } = await serve(body, 200);
    try {
      const loaded = await loadOpenApi(`${url}/shop.openapi.yaml`);
      expect(loaded.version).toBe("3.0.3");
      expect(loaded.operations).toEqual(shopOps);
    } finally {
      await close();
    }
  });

  it("loads json from a url whose body starts with a brace", async () => {
    const body = await readFile(shopJson, "utf8");
    const { url, close } = await serve(body, 200);
    try {
      const loaded = await loadOpenApi(`${url}/spec`);
      expect(loaded.operations.map((op) => op.operationId ?? op.method)).toEqual([
        "listItems",
        "createItem",
        "getItem",
        "delete",
      ]);
    } finally {
      await close();
    }
  });

  it("reports a non-200 from the spec url", async () => {
    const { url, close } = await serve("nope", 404);
    try {
      await expect(loadOpenApi(`${url}/missing.yaml`)).rejects.toThrow(/HTTP 404/);
    } finally {
      await close();
    }
  });
});

function serve(body: string, status: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.statusCode = status;
    res.setHeader("content-type", "text/plain");
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((err) => (err ? reject(err) : done()));
          }),
      });
    });
  });
}
