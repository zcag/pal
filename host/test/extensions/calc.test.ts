// calc: mathjs over the query, an input palette.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const calc = (q: string) => host.list("calc", "calc", q);

describe("calc", () => {
  test("meta: input palette with a placeholder", () => {
    expect(host.loaded().find((l) => l.extension === "calc")!.palettes[0]).toEqual({ name: "calc", title: "Calculator", live: false, input: true, icon: "=", placeholder: "Calculate" });
  });

  test("2+2 is one row: the result as the title and id, the expression as subtitle, a copy action", async () => {
    expect(await calc("2+2")).toEqual([{ id: "4", name: "4", subtitle: "2+2", icon: "=", actions: [{ id: "copy", title: "Copy result" }] }]);
  });

  test("percent-of, degree signs and units are rewritten for mathjs", async () => {
    expect((await calc("15% of 240"))[0].name).toBe("36");
    expect((await calc("50%"))[0].name).toBe("0.5");
    expect((await calc("12 GB to MB"))[0].name).toBe("12000 MB");
    expect((await calc("3 weeks to days"))[0].name).toBe("21 days");
    expect((await calc("212 °F to °C"))[0].name).toBe("100 degC");
    expect((await calc("sqrt(16)"))[0].name).toBe("4");
  });

  test("an empty query lists inert hints; whitespace counts as empty", async () => {
    const hints = await calc("");
    expect(hints).toHaveLength(2);
    for (const h of hints) { expect(h.actions).toEqual([]); expect(h.id).toMatch(/^hint:/); }
    expect(await calc("   ")).toEqual(hints);
    expect(await host.list("calc", "calc")).toEqual(hints);
  });

  test("an invalid or valueless expression lists nothing", async () => {
    expect(await calc("foo(((")).toEqual([]);
    expect(await calc("hello world")).toEqual([]);
    expect(await calc("sqrt")).toEqual([]);
  });

  test("pick copies the result; precision follows the setting", async () => {
    expect(await host.pick("calc", "calc", "4")).toEqual({ copy: "4" });
    expect((await calc("1/3"))[0].name).toBe("0.33333333333333");
    host.changeSettings("calc", { settings: { precision: 3 } });
    expect((await calc("1/3"))[0].name).toBe("0.333");
  });
});
