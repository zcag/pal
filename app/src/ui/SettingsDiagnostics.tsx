import type { Diagnostic } from "./SettingsTypes";

export type SettingsDiagnosticsProps = {
  diagnostics: Diagnostic[];
  /** Shown as the file's name in the lead line. */
  file?: string;
  onOpen?: (d: Diagnostic) => void;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What the config core found in the file, one line each, with the line
 * number when it knows one. An error means the file did not parse and pal
 * kept the last good settings; the lead line says so.
 */
export function SettingsDiagnostics({ diagnostics, file = "config.toml", onOpen }: SettingsDiagnosticsProps) {
  if (!diagnostics.length) return null;
  const errors = diagnostics.filter((d) => d.level === "error").length;
  const warnings = diagnostics.length - errors;
  const counts = [errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean).join(", ");
  return (
    <div className="pal-diag" role="region" aria-label={`Problems in ${file}`} data-level={errors ? "error" : "warning"}>
      <p className="pal-diag__lead">
        <span className="pal-diag__counts">{counts} in {file}.</span>
        {errors ? " The file did not parse, so pal is still using the last settings that did." : " Unknown keys stay in the file and are ignored."}
      </p>
      <ul className="pal-diag__list">
        {diagnostics.map((d, i) => (
          <li key={i} className="pal-diag__row" data-level={d.level}>
            <span className="pal-diag__mark" aria-hidden>{d.level === "error" ? "✕" : "!"}</span>
            <span className="pal-diag__level">{d.level}</span>
            <span className="pal-diag__message">
              {d.message}
              {d.path && <code className="pal-diag__path">{d.path}</code>}
            </span>
            {d.line !== undefined && (
              <button type="button" className="pal-diag__line" onClick={() => onOpen?.(d)} title="Open the file at this line">
                line {d.line}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
