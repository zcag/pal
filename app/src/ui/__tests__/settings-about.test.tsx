// @vitest-environment happy-dom
// Settings > About's Version row: the last check's answer, "Install
// <version>" only when this build can be installed over, the progress
// line from `pal://update` while it runs, the failure as an error line.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsAbout, installing, progressLine, type UpdateInfo, type UpdateProgress } from "../SettingsAbout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

const links = { docs: "https://pal.cagdas.io/docs", repo: "https://github.com/zcag/pal" };
const show = (update: UpdateInfo | undefined, progress?: UpdateProgress, onInstallUpdate = vi.fn(async () => {})) =>
  act(() => { root.render(<SettingsAbout version="0.1.0" file="/x/config.toml" links={links} update={update} progress={progress} onInstallUpdate={onInstallUpdate} onCheckUpdates={async () => update ?? { available: false }} />); });
const row = () => el.querySelector<HTMLElement>('[data-anchor="about:updates"]')!;
const buttons = () => [...row().querySelectorAll("button")].map((b) => [b.textContent, b.disabled] as const);

describe("progressLine", () => {
  it("says the step, the percentage when the size is known, the megabytes when not", () => {
    expect(progressLine(undefined)).toBe("");
    expect(progressLine({ phase: "idle" })).toBe("");
    expect(progressLine({ phase: "downloading", version: "0.2.0", downloaded: 6_000_000, total: 12_000_000 })).toBe("Downloading 0.2.0: 50% of 12.0 MB…");
    expect(progressLine({ phase: "downloading", version: "0.2.0", downloaded: 2_500_000 })).toBe("Downloading 0.2.0: 2.5 MB…");
    expect(progressLine({ phase: "installing", version: "0.2.0" })).toBe("Installing 0.2.0…");
    expect(progressLine({ phase: "restarting", version: "0.2.0" })).toBe("0.2.0 is installed; pal is restarting.");
    expect(progressLine({ phase: "failed", version: "0.2.0", error: "no space" })).toBe("Installing 0.2.0 failed: no space");
    expect(installing({ phase: "downloading", version: "0.2.0", downloaded: 0 })).toBe(true);
    expect(installing({ phase: "failed", version: "0.2.0", error: "x" })).toBe(false);
    expect(installing(undefined)).toBe(false);
  });
});

describe("the Version row", () => {
  it("without a check: the daily line and Check for Updates only", async () => {
    await show(undefined);
    expect(row().textContent).toContain("Checked once a day");
    expect(buttons()).toEqual([["Check for Updates", false]]);
  });

  it("an installable release: Install <version>, which calls onInstallUpdate", async () => {
    const install = vi.fn(async () => {});
    await show({ available: true, version: "0.2.0", installable: true }, undefined, install);
    expect(row().textContent).toContain("0.2.0 is available. Install downloads it");
    expect(buttons()).toEqual([["Install 0.2.0", false], ["Check for Updates", false]]);
    await act(async () => { row().querySelector("button")!.click(); });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("a release this build cannot install over: the reason, no Install", async () => {
    await show({ available: true, version: "0.2.0", installable: false, install_note: "installed from the .deb: use dpkg" });
    expect(row().textContent).toContain("0.2.0 is available: installed from the .deb: use dpkg.");
    expect(buttons()).toEqual([["Check for Updates", false]]);
  });

  it("while installing the row says where it is and both buttons wait; a failure is an error line and Install is back", async () => {
    const info: UpdateInfo = { available: true, version: "0.2.0", installable: true };
    await show(info, { phase: "downloading", version: "0.2.0", downloaded: 3_000_000, total: 12_000_000 });
    expect(row().textContent).toContain("Downloading 0.2.0: 25% of 12.0 MB…");
    expect(buttons()).toEqual([["Downloading…", true], ["Check for Updates", true]]);
    await show(info, { phase: "installing", version: "0.2.0" });
    expect(buttons()[0]).toEqual(["Installing…", true]);
    await show(info, { phase: "failed", version: "0.2.0", error: "signature mismatch" });
    expect(row().querySelector("[data-error]")!.textContent).toBe("Installing 0.2.0 failed: signature mismatch");
    expect(buttons()).toEqual([["Install 0.2.0", false], ["Check for Updates", false]]);
  });

  it("a refused install shows the refusal", async () => {
    await show({ available: true, version: "0.2.0", installable: true }, undefined, vi.fn(async () => { throw new Error("an update is already being installed"); }));
    await act(async () => { row().querySelector("button")!.click(); });
    expect(row().querySelector("[data-error]")!.textContent).toContain("already being installed");
  });
});
