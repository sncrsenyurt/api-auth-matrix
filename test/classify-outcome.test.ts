import { describe, expect, it } from "vitest";
import { classifyStatus } from "../src/classify-outcome.js";

describe("classifyStatus", () => {
  it("treats 2xx as allowed and 401 or 403 as denied", () => {
    expect(classifyStatus(200)).toBe("allowed");
    expect(classifyStatus(201)).toBe("allowed");
    expect(classifyStatus(204)).toBe("allowed");
    expect(classifyStatus(299)).toBe("allowed");
    expect(classifyStatus(401)).toBe("denied");
    expect(classifyStatus(403)).toBe("denied");
  });

  it("leaves other statuses alone", () => {
    expect(classifyStatus(301)).toBe("other");
    expect(classifyStatus(400)).toBe("other");
    expect(classifyStatus(404)).toBe("other");
    expect(classifyStatus(500)).toBe("other");
  });
});
