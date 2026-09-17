// terminal.ts: the terminal the extensions open (apps, ssh, docker, make,
// shell, files). The Linux chooser is pure; the macOS `argv` table needs
// the app installed, so it is checked through a name that is not, and the
// `on`/`at` table (a shell in a folder) is pure on both platforms.
import { describe, expect, test } from "bun:test";
import { LINUX_TERMINALS, argv, at, linux, linuxArgv, on, quote } from "../../sdk/src/terminal.ts";

const MAC = process.platform === "darwin";

describe("the Linux terminal", () => {
  test("$TERMINAL wins, else the first installed in order, else nothing; each program takes the command its own way", () => {
    const only = (...names: string[]) => (n: string) => (names.includes(n) ? `/usr/bin/${n}` : null);
    expect(linux({ TERMINAL: " ghostty " }, only("kitty"))).toBe("ghostty");
    expect(linux({}, only("xterm", "foot"))).toBe("foot");
    expect(linux({}, only("kitty", "x-terminal-emulator"))).toBe("x-terminal-emulator");
    expect(linux({ TERMINAL: "" }, () => null)).toBeUndefined();
    expect(LINUX_TERMINALS[0]).toBe("x-terminal-emulator");
    expect(linuxArgv("/usr/bin/kitty", ["htop"])).toEqual(["/usr/bin/kitty", "htop"]);
    expect(linuxArgv("foot", ["htop"])).toEqual(["foot", "htop"]);
    expect(linuxArgv("wezterm", ["htop"])).toEqual(["wezterm", "start", "--", "htop"]);
    expect(linuxArgv("gnome-terminal", ["htop"])).toEqual(["gnome-terminal", "--", "htop"]);
    expect(linuxArgv("alacritty", ["htop"])).toEqual(["alacritty", "-e", "htop"]);
  });
});

describe("a command in a new window", () => {
  test("quote: bare when safe, single-quoted otherwise", () => {
    expect(quote("ssh")).toBe("ssh");
    expect(quote("user@host.example:22")).toBe("user@host.example:22");
    expect(quote("it's a path")).toBe(`'it'\\''s a path'`);
  });
  test("a named app that is not installed is the reason; on Linux $TERMINAL takes the command", () => {
    if (MAC) expect(argv(["ssh", "x"], "Ghostty")).toMatch(/^(Ghostty\.app is not installed|\/)/);
    else { process.env.TERMINAL = "foot"; expect(argv(["ssh", "x"])).toEqual(["foot", "ssh", "x"]); delete process.env.TERMINAL; }
  });
});

describe("a shell in a folder", () => {
  const sh = ["/bin/zsh", "-lic"];
  test("Terminal and iTerm over osascript, kitty and the others by flags, any other name through open; the line cds first", () => {
    if (!MAC) return;
    const t = on("ls -la; exec /bin/zsh", "/Users/x/proj", sh, "")!;
    expect(t.slice(0, 3)).toEqual(["osascript", "-e", `tell application "Terminal"`]);
    expect(t[6]).toBe(`do script "cd '/Users/x/proj' && ls -la; exec /bin/zsh"`);
    expect(on("ls", "/tmp", sh, "iTerm")![2]).toBe(`tell application "iTerm"`);
    expect(on("ls; exec /bin/zsh", "/tmp", sh, "kitty")).toEqual(["open", "-na", "kitty", "--args", "--directory", "/tmp", "/bin/zsh", "-c", "ls; exec /bin/zsh"]);
    expect(on("ls", "/tmp", sh, "Ghostty")![4]).toBe("--working-directory=/tmp");
    expect(on("ls; exec /bin/zsh", "/tmp", sh, "Warp")).toEqual(["open", "-na", "Warp", "--args", "-e", "/bin/zsh", "-c", "cd '/tmp' && ls; exec /bin/zsh"]);
    expect(on("ls", "/it's", sh, "Warp")!.at(-1)).toBe(`cd '/it'\\''s' && ls`);
    expect(at("/a/b c", "kitty", ["/bin/zsh"])).toEqual(["open", "-na", "kitty", "--args", "--directory", "/a/b c", "/bin/zsh", "-c", "exec /bin/zsh"]);
    expect(at("/a", "", ["/bin/zsh"])).toEqual(["osascript", "-e", 'tell application "Terminal"', "-e", "activate", "-e", `do script "cd '/a' && exec /bin/zsh"`, "-e", "end tell"]);
  });
  test("Linux: the setting wins over $TERMINAL, which wins over what is installed; none is undefined", () => {
    if (MAC) return;
    expect(on("ls; exec /bin/zsh", "/tmp", sh, "", { TERMINAL: "foot" })).toEqual(["foot", "/bin/zsh", "-c", "cd '/tmp' && ls; exec /bin/zsh"]);
    expect(on("ls", "/tmp", sh, "alacritty", { TERMINAL: "foot" })).toEqual(["alacritty", "-e", "/bin/zsh", "-c", "cd '/tmp' && ls"]);
    expect(on("ls", "/tmp", sh, "", {}, (n) => (n === "wezterm" ? "/usr/bin/wezterm" : null))!.slice(0, 3)).toEqual(["wezterm", "start", "--"]);
    expect(on("ls", "/tmp", sh, "", {}, () => null)).toBeUndefined();
    expect(at("/a", "", ["/bin/zsh"], { TERMINAL: "foot" })).toEqual(["foot", "/bin/zsh", "-c", "cd '/a' && exec /bin/zsh"]);
  });
});
