import {
  Clipboard,
  Detail,
  Keyboard,
  Toast,
  closeMainWindow,
  open,
  showHUD,
  showToast,
} from "@raycast/api";
import type { useNavigation } from "@raycast/api";
import { Envelope, ItemDetail, parseEnvelope } from "./pal";
import { Metadata } from "../components/Metadata";

const TOAST_STYLES: Record<string, Toast.Style> = {
  success: Toast.Style.Success,
  failure: Toast.Style.Failure,
  error: Toast.Style.Failure,
  animated: Toast.Style.Animated,
};

/**
 * Raycast bundles its own copy of @types/react, so a bare ReactNode from the
 * top-level types isn't assignable here. Take the signature from the hook.
 */
type Push = ReturnType<typeof useNavigation>["push"];

export type EnvelopeHandlers = {
  /** Push a view (used by `show`, and by long plain output). */
  push: Push;
  /** Refresh the list (used by `reload`). */
  revalidate: () => void;
};

/**
 * Turn a pick's output into Raycast feedback.
 *
 * pal defines the envelope; deciding that a short line becomes a HUD while a
 * wall of text becomes a pushed Detail is a Raycast rendering call, so it
 * lives here.
 */
export async function handleOutput(
  output: string,
  title: string,
  handlers: EnvelopeHandlers,
): Promise<void> {
  const envelope = parseEnvelope(output);
  if (envelope) return handleEnvelope(envelope, handlers);

  const text = output.trim();
  if (!text) {
    await showHUD(title);
    return;
  }
  if (text.length <= 120 && !text.includes("\n")) {
    await showHUD(text);
    return;
  }
  handlers.push(
    <Detail
      navigationTitle={title}
      markdown={"```\n" + text.replace(/```/g, "``​`") + "\n```"}
    />,
  );
}

async function handleEnvelope(env: Envelope, handlers: EnvelopeHandlers): Promise<void> {
  if (env.clipboard !== undefined) {
    await Clipboard.copy(env.clipboard);
  }
  if (env.open) {
    await open(env.open);
  }
  if (env.show) {
    handlers.push(<DetailView detail={env.show} />);
  }
  if (env.toast) {
    await showToast({
      style: TOAST_STYLES[env.toast.style?.toLowerCase() ?? ""] ?? Toast.Style.Success,
      title: env.toast.title ?? "",
      message: env.toast.message,
    });
  }
  if (env.hud) {
    await showHUD(env.hud);
    return; // showHUD already closes the window
  }
  if (env.reload) {
    handlers.revalidate();
  }
  if (env.close) {
    await closeMainWindow();
  }
}

function DetailView({ detail }: { detail: ItemDetail }) {
  return (
    <Detail
      markdown={detail.markdown ?? ""}
      metadata={detail.metadata?.length ? <Detail.Metadata><Metadata entries={detail.metadata} /></Detail.Metadata> : undefined}
    />
  );
}

const MODIFIERS: Record<string, Keyboard.KeyModifier> = {
  cmd: "cmd",
  command: "cmd",
  ctrl: "ctrl",
  control: "ctrl",
  opt: "opt",
  option: "opt",
  alt: "opt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, Keyboard.KeyEquivalent> = {
  enter: "return",
  ret: "return",
  esc: "escape",
  del: "delete",
  up: "arrowUp",
  down: "arrowDown",
  left: "arrowLeft",
  right: "arrowRight",
};

/** Parse pal's "cmd+shift+r" shorthand into a Raycast shortcut. */
export function parseShortcut(value?: string): Keyboard.Shortcut | undefined {
  if (!value) return undefined;
  const parts = value.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2) return undefined;

  const key = parts.pop() as string;
  const modifiers = parts.map((p) => MODIFIERS[p]).filter(Boolean);
  if (!modifiers.length) return undefined;

  return {
    modifiers,
    key: (KEY_ALIASES[key] ?? key) as Keyboard.KeyEquivalent,
  };
}
