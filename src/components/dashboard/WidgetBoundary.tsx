/**
 * Local error boundary for one dashboard widget. A crash in one card shows a small inline
 * message with Retry instead of taking down the whole dashboard.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";

interface Props {
  /** Widget name, used in the message and the log. */
  name: string;
  children: ReactNode;
  className?: string;
  /** Any change resets a crashed boundary (for example a symbol). */
  resetKey?: string | number;
}

interface State {
  error: Error | null;
  resetKey?: string | number;
}

export class WidgetBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error(`Dashboard widget "${this.props.name}" crashed`, { message: error.message, stack: info.componentStack });
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className={cn("flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-separator-strong bg-card p-4 text-center", this.props.className)}
      >
        <AlertTriangle className="h-5 w-5 text-bearish" aria-hidden="true" />
        <p className="text-body font-medium text-foreground">{this.props.name} could not be shown.</p>
        <p className="max-w-sm text-body-sm text-muted-foreground">The rest of the dashboard still works. Try again, or reload the page if it keeps failing.</p>
        <Button type="button" variant="outline" onClick={this.reset}>
          <RefreshCw className="!size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }
}
