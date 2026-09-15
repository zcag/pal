export type ToastSpec = {
  title: string;
  message?: string;
  style: "success" | "failure" | "animated";
};

/** Bottom-left transient notice. `animated` shows a spinner for work in progress. */
export function Toast({ toast }: { toast: ToastSpec }) {
  return (
    <div className="pal-toast" data-style={toast.style} role="status" aria-live="polite">
      <span className="pal-toast__mark" aria-hidden>
        {toast.style === "success" ? "✓" : toast.style === "failure" ? "✕" : <span className="pal-spinner" />}
      </span>
      <span className="pal-toast__title">{toast.title}</span>
      {toast.message && <span className="pal-toast__message">{toast.message}</span>}
    </div>
  );
}
