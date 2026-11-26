import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listOperations } from "../src/list-operations.js";
import { loadOpenApi } from "../src/read-openapi.js";

const ordersSpec = path.join("test", "fixtures", "orders.openapi.yaml");

describe("listOperations", () => {
  it("lists operations behind local refs and merges parameters", async () => {
    const loaded = await loadOpenApi(ordersSpec);
    expect(loaded.operations.map((operation) => operation.operationId ?? operation.method)).toEqual([
      "listOrders",
      "createOrder",
      "getOrder",
      "deleteOrder",
      "addNote",
      "createNote",
      "listNotes",
    ]);

    const listed = listOperations(loaded.document, ordersSpec);
    const listOrders = listed.find((operation) => operation.operationId === "listOrders");
    const getOrder = listed.find((operation) => operation.operationId === "getOrder");
    const createOrder = listed.find((operation) => operation.operationId === "createOrder");
    const listNotes = listed.find((operation) => operation.operationId === "listNotes");
    const addNote = listed.find((operation) => operation.operationId === "addNote");

    expect(listOrders?.parameters.map((parameter) => parameter.name)).toEqual(["status", "limit"]);
    expect(listOrders?.parameters[0]).toMatchObject({
      in: "query",
      required: false,
      schema: { type: "string", enum: ["open", "paid", "void"] },
    });
    expect(listOrders?.parameters[1].schema).toMatchObject({ type: "integer", default: 10 });

    expect(getOrder).toMatchObject({ method: "get", path: "/orders/{id}" });
    expect(getOrder?.parameters).toEqual([
      {
        name: "id",
        in: "path",
        required: true,
        example: "from-param",
        schema: { type: "string", example: "from-schema" },
      },
    ]);

    expect(createOrder?.body).toMatchObject({
      required: true,
      contentType: "application/json",
      example: { sku: "mug", qty: 1 },
    });
    expect(createOrder?.body?.schema).toMatchObject({
      allOf: [
        { required: ["sku"], properties: { sku: { type: "string" } } },
        { required: ["qty"], properties: { qty: { type: "integer", default: 1 } } },
      ],
    });
    expect(JSON.stringify(createOrder?.body?.schema)).not.toContain("$ref");

    expect(listNotes?.parameters).toEqual([
      {
        name: "userId",
        in: "path",
        required: true,
        schema: { type: "string", example: "overridden" },
      },
    ]);

    expect(addNote?.body?.example).toEqual({ kind: "gift", text: "from-examples" });
    expect(addNote?.body?.schema).toMatchObject({
      properties: { kind: { enum: ["rush", "gift"] }, pinned: { default: false } },
    });
  });

  it("rejects a parameter list that is not a list", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ops-"));
    const file = path.join(dir, "bad.yaml");
    await writeFile(
      file,
      'openapi: "3.0.3"\npaths:\n  /items:\n    get:\n      parameters:\n        name: id\n',
    );
    await expect(loadOpenApi(file)).rejects.toThrow(/GET \/items parameters must be a list/);
  });
});
