import { useEffect, useState } from "react";
import { cachedShellPath, shellPath } from "./pal";

/**
 * The environment pal (and its plugins) need. The first run pays for one login
 * shell; after that it comes straight out of Raycast's synchronous Cache, so
 * the list paints without waiting.
 */
export function usePalEnv() {
  const [path, setPath] = useState<string | undefined>(cachedShellPath);

  useEffect(() => {
    if (path) return;
    let cancelled = false;
    shellPath()
      .then((resolved) => !cancelled && setPath(resolved))
      .catch(() => !cancelled && setPath(process.env.PATH ?? ""));
    return () => {
      cancelled = true;
    };
  }, [path]);

  return {
    env: path ? { ...process.env, PATH: path } : undefined,
    ready: path !== undefined,
  };
}
