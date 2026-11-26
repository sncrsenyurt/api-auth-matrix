import { describe, expect, it } from "vitest";
import { deepResolve, resolveLocalRef } from "../src/resolve-ref.js";

const root = {
  openapi: "3.0.3",
  components: {
    schemas: {
      OrderId: { type: "string", example: "from-schema" },
      Note: {
        type: "object",
        properties: {
          text: { $ref: "#/components/schemas/OrderId" },
        },
      },
      "a/b": { type: "string", example: "slash" },
      "a~b": { type: "string", example: "tilde" },
    },
    parameters: {
      OrderId: {
        name: "id",
        in: "path",
        schema: { $ref: "#/components/schemas/OrderId" },
      },
    },
  },
};

describe("resolveLocalRef", () => {
  it("follows a local pointer and leaves the document alone", () => {
    const snapshot = structuredClone(root);
    const resolved = resolveLocalRef(root, { $ref: "#/components/parameters/OrderId" });
    expect(resolved).toMatchObject({ name: "id", in: "path" });
    expect(root).toEqual(snapshot);
  });

  it("decodes ~0 and ~1 in a pointer", () => {
    expect(resolveLocalRef(root, { $ref: "#/components/schemas/a~1b" })).toMatchObject({ example: "slash" });
    expect(resolveLocalRef(root, { $ref: "#/components/schemas/a~0b" })).toMatchObject({ example: "tilde" });
  });

  it("ignores sibling keys on a 3.0 document", () => {
    const resolved = resolveLocalRef(root, {
      $ref: "#/components/schemas/OrderId",
      example: "sibling",
    });
    expect(resolved).toEqual({ type: "string", example: "from-schema" });
  });

  it("lets sibling keys override on a 3.1 document", () => {
    const newer = { ...root, openapi: "3.1.0" };
    const resolved = resolveLocalRef(newer, {
      $ref: "#/components/schemas/OrderId",
      example: "sibling",
    });
    expect(resolved).toEqual({ type: "string", example: "sibling" });
  });

  it("rejects an external ref, a missing pointer, and a ref cycle", () => {
    expect(() => resolveLocalRef(root, { $ref: "./other.yaml#/components/schemas/X" })).toThrow(
      /external \$ref is not supported/,
    );
    expect(() => resolveLocalRef(root, { $ref: "https://example.com/spec.yaml#/components/schemas/X" })).toThrow(
      /external \$ref is not supported/,
    );
    expect(() => resolveLocalRef(root, { $ref: "#/components/schemas/Missing" })).toThrow(/\$ref not found/);

    const cyclic = {
      openapi: "3.0.3",
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { $ref: "#/components/schemas/A" },
        },
      },
    };
    expect(() => resolveLocalRef(cyclic, { $ref: "#/components/schemas/A" })).toThrow(/circular \$ref/);
  });
});

describe("deepResolve", () => {
  it("inlines nested refs", () => {
    const resolved = deepResolve(root, { $ref: "#/components/schemas/Note" }) as {
      properties: { text: { example?: string } };
    };
    expect(resolved.properties.text.example).toBe("from-schema");
    expect(JSON.stringify(resolved)).not.toContain("$ref");
  });

  it("stops when a schema points back at itself", () => {
    const recursive = {
      openapi: "3.0.3",
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              name: { type: "string", example: "root" },
              child: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };
    const resolved = deepResolve(recursive, { $ref: "#/components/schemas/Node" }) as {
      properties: { name: { example?: string }; child: Record<string, unknown> };
    };
    expect(resolved.properties.name.example).toBe("root");
    expect(resolved.properties.child).toEqual({});
  });
});
