import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "@/i18n";

interface Props {
  children: ReactNode;
  /** Changing it clears the error (e.g. the current route). */
  resetKey?: string;
}

/** Shows a way out instead of a blank screen when a page crashes. */
export class ErrorBoundary extends Component<Props, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <AlertTriangle className="size-8 text-warning" />
        <p className="font-medium">{t("Algo falló en esta pantalla")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{this.state.error.message}</p>
        <div className="flex gap-2">
          <button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted" onClick={() => history.back()}>
            {t("Volver")}
          </button>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => location.reload()}>
            {t("Recargar")}
          </button>
        </div>
      </div>
    );
  }
}
