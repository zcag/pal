// The wire's one rule (protocol.ts): a line is a request, notification or
// response by shape alone. `kind` in the harness is that rule; the host's
// side of it is covered in host.test.ts ("a line that is not JSON...").
import { describe, expect, test } from "bun:test";
import { kind } from "./harness.ts";

describe("classification by shape", () => {
  test("method with id is a request", () => expect(kind({ id: 1, method: "list", params: {} })).toBe("request"));
  test("method without id is a notification", () => expect(kind({ method: "host/ready" })).toBe("notification"));
  test("no method is a response, result or error", () => {
    expect(kind({ id: 1, result: { items: [] } })).toBe("response");
    expect(kind({ id: 1, error: "boom" })).toBe("response");
    expect(kind({ id: 1 })).toBe("response");
  });
  test("id 0 still counts as an id", () => expect(kind({ id: 0, method: "x" })).toBe("request"));
});
