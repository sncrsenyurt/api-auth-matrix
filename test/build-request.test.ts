import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRequest } from "../src/build-request.js";
import type { ListedOperation } from "../src/list-operations.js";
import { listOperations } from "../src/list-operations.js";
import { loadOpenApi } from "../src/read-openapi.js";
import { findPolicy, loadPolicy } from "../src/read-policy.js";
import { loadRoles } from "../src/read-roles.js";

const ordersSpec = path.join("test", "fixtures", "orders.openapi.yaml");
const ordersRoles = path.join("test", "fixtures", "roles.orders.yaml");
const ordersPolicy = path.join("test", "fixtures", "policy.orders.yaml");

const env = {
  USER_TOKEN: "user-token-value",
  OTHER_USER_TOKEN: "other-token-value",
  ADMIN_TOKEN: "admin-token-value",
  USER_ORDER_ID: "ord-a",
  OTHER_ORDER_ID: "ord-b",
};

describe("buildRequest", () => {
  it("fills query and body from enums, defaults, and examples", async () => {
    const listed = await loadOrders();
    const listOrders = mustFind(listed, "listOrders");
    const createOrder = mustFind(listed, "createOrder");
    const createNote = mustFind(listed, "createNote");
    const addNote = mustFind(listed, "addNote");

    expect(buildRequest(listOrders).query).toEqual([
      { name: "status", value: "open" },
      { name: "limit", value: "10" },
    ]);
    expect(buildRequest(createOrder)).toMatchObject({
      path: "/orders",
      contentType: "application/json",
      body: { sku: "mug", qty: 1 },
    });
    expect(buildRequest(createNote).body).toEqual({ kind: "rush", text: "hello", pinned: false });
    expect(buildRequest(addNote, { orderId: "ord-a" }, { id: "orderId" }).body).toEqual({
      kind: "gift",
      text: "from-examples",
    });
  });

  it("uses each role's resource id, and the spec example when the role has none", async () => {
    const listed = await loadOrders();
    const policies = await loadPolicy(ordersPolicy);
    const roles = await loadRoles(ordersRoles, env);
    const getOrder = mustFind(listed, "getOrder");
    const listNotes = mustFind(listed, "listNotes");
    const mapping = findPolicy(policies, getOrder.method, getOrder.path, getOrder.operationId)?.resources ?? {};

    const user = roles.find((role) => role.name === "user");
    const other = roles.find((role) => role.name === "other_user");
    const anonymous = roles.find((role) => role.name === "anonymous");
    if (!user || !other || !anonymous) throw new Error("missing role");

    const asUser = buildRequest(getOrder, user.resources, mapping);
    const asOther = buildRequest(getOrder, other.resources, mapping);
    const asAnonymous = buildRequest(getOrder, anonymous.resources, mapping);
    expect(asUser.path).toBe("/orders/ord-a");
    expect(asOther.path).toBe("/orders/ord-b");
    expect(asAnonymous.path).toBe("/orders/from-param");
    expect(asUser.headers).toEqual({});
    expect(JSON.stringify(asUser)).not.toContain("user-token-value");

    const notes = buildRequest(
      listNotes,
      user.resources,
      findPolicy(policies, listNotes.method, listNotes.path, listNotes.operationId)?.resources ?? {},
    );
    expect(notes.path).toBe("/users/user-a/notes");
  });

  it("encodes path ids and repeats exploded query values", () => {
    const byId: ListedOperation = {
      method: "get",
      path: "/orders/{id}",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
    };
    expect(buildRequest(byId, { id: "ord a" }).path).toBe("/orders/ord%20a");

    const tagged: ListedOperation = {
      method: "get",
      path: "/orders",
      parameters: [
        {
          name: "tag",
          in: "query",
          required: false,
          example: ["red", "blue"],
        },
        {
          name: "sort",
          in: "query",
          required: false,
          style: "form",
          explode: false,
          example: ["new", "old"],
        },
      ],
    };
    expect(buildRequest(tagged).query).toEqual([
      { name: "tag", value: "red" },
      { name: "tag", value: "blue" },
      { name: "sort", value: "new,old" },
    ]);
  });

  it("overlays a resource onto an example body and merges allOf", () => {
    const create: ListedOperation = {
      method: "post",
      path: "/orders",
      parameters: [],
      body: {
        required: true,
        contentType: "application/json",
        example: { sku: "mug", qty: 1 },
        schema: {
          allOf: [
            { type: "object", properties: { sku: { type: "string", example: "other" } } },
            { type: "object", properties: { qty: { type: "integer", default: 2 } } },
          ],
        },
      },
    };
    expect(buildRequest(create, { sku: "cup" }).body).toEqual({ sku: "cup", qty: 1 });

    const drafted: ListedOperation = {
      method: "post",
      path: "/drafts",
      parameters: [],
      body: {
        required: true,
        contentType: "application/json",
        schema: {
          allOf: [
            {
              type: "object",
              required: ["sku"],
              properties: { sku: { type: "string", example: "mug" } },
            },
            {
              type: "object",
              properties: { qty: { type: "integer", default: 2 } },
            },
          ],
        },
      },
    };
    expect(buildRequest(drafted).body).toEqual({ sku: "mug", qty: 2 });
  });

  it("throws when a required path param or body property has nothing to fill", () => {
    const missing: ListedOperation = {
      method: "get",
      path: "/widgets/{id}",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    };
    expect(() => buildRequest(missing)).toThrow(/cannot fill path parameter id for GET \/widgets\/\{id\}/);

    const body: ListedOperation = {
      method: "post",
      path: "/widgets",
      parameters: [],
      body: {
        required: true,
        contentType: "application/json",
        schema: {
          type: "object",
          required: ["sku"],
          properties: { sku: { type: "string" } },
        },
      },
    };
    expect(() => buildRequest(body)).toThrow(/cannot fill required property sku for POST \/widgets/);
  });
});

async function loadOrders(): Promise<ListedOperation[]> {
  const loaded = await loadOpenApi(ordersSpec);
  return listOperations(loaded.document, ordersSpec);
}

function mustFind(operations: ListedOperation[], operationId: string): ListedOperation {
  const found = operations.find((operation) => operation.operationId === operationId);
  if (!found) throw new Error(`missing ${operationId}`);
  return found;
}
