import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Kbd reads `window` at import for the platform; static markup needs no DOM beyond that.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { Confirm } from "../Confirm";

const render = (message?: string) => renderToStaticMarkup(<Confirm title="Install hello from a link?" message={message} action="Install" onConfirm={() => {}} onCancel={() => {}} />);

describe("Confirm", () => {
  it("asks the question with the action as the go-ahead", () => {
    const html = render();
    expect(html).toContain("Install hello from a link?");
    expect(html).toContain("data-primary");
    expect(html).not.toContain("pal-confirm__message");
  });
  it("shows what the question is about under it, when given (a link's spec)", () => {
    const html = render("github:zcag/pal/examples/hello-extension@pali");
    expect(html).toContain('class="pal-confirm__message">github:zcag/pal/examples/hello-extension@pali<');
  });
});
