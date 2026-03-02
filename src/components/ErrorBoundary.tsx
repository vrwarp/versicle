import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { createLogger } from '../lib/logger';
import { DataRecoveryView } from './settings/DataRecoveryView';

const logger = createLogger('ErrorBoundary');

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showRecovery: boolean;
}

/**
 * Error Boundary component to catch JavaScript errors anywhere in the child component tree.
 * Displays a fallback UI instead of crashing the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showRecovery: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error, errorInfo: null, showRecovery: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // You can also log the error to an error reporting service
    logger.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleToggleRecovery = () => {
    this.setState((prev) => ({ showRecovery: !prev.showRecovery }));
  };

  render() {
    if (this.state.hasError) {
      if (this.state.showRecovery) {
        return (
          <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background text-foreground text-center">
            <div className="w-full max-w-4xl h-[80vh] flex flex-col items-stretch text-left">
              <div className="flex justify-between items-center mb-4">
                <Button onClick={this.handleToggleRecovery} variant="outline">
                  Back to Error Page
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <DataRecoveryView />
              </div>
            </div>
          </div>
        );
      }

      // You can render any custom fallback UI
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background text-foreground text-center">
          <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
          <p className="mb-6 text-muted-foreground max-w-md">
            We encountered an unexpected error. You can try reloading the page.
          </p>
          {/* Optional: Show error details in development */}
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="mb-6 p-4 bg-muted text-left overflow-auto w-full max-w-2xl text-xs rounded border border-border">
              {this.state.error.toString()}
              <br />
              {this.state.errorInfo?.componentStack}
            </pre>
          )}

          <div className="flex gap-4">
            <Button onClick={this.handleReload} variant="default">
              Reload Page
            </Button>
            <Button onClick={this.handleToggleRecovery} variant="outline">
              Data Recovery
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
