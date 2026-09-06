import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, RefreshCw, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-12 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 mb-2">
              <Bug className="h-7 w-7 text-destructive" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">{this.props.fallbackMessage || "A component crashed."}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                The terminal encountered an unexpected error. You can try recovering the module or refresh the page.
              </p>
            </div>
            {this.state.error && (
              <div className="mt-4 p-3 bg-background/50 border border-border/50 rounded-md max-w-md mx-auto overflow-x-auto text-left">
                <p className="text-xs font-mono text-destructive/80 leading-relaxed break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="pt-2 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 hover:text-destructive hover:border-destructive/50 transition-colors"
                onClick={() => this.setState({ hasError: false, error: undefined })}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Recover Module
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={() => window.location.reload()}
              >
                Reload Terminal
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
