import React from 'react';
import { Button } from './ui/Button';

interface SafeModeViewProps {
  error: unknown;
  onReset: () => void;
  onRetry: () => void;
}

export const SafeModeView: React.FC<SafeModeViewProps> = ({ error, onReset, onRetry }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-6 text-center">
      <h1 className="text-3xl font-bold text-destructive mb-4">Safe Mode</h1>
      <p className="text-lg text-muted-foreground mb-6 max-w-md">
        The application failed to initialize the database. This might be due to corruption or a storage error.
      </p>

      <div className="bg-card border border-border p-4 rounded-md mb-8 max-w-lg w-full text-left overflow-auto max-h-48">
        <p className="text-sm font-mono text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
        {error instanceof Error && error.stack && (
          <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">
            {error.stack}
          </pre>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Button onClick={onRetry} variant="secondary">
          Try Again
        </Button>
        <Button onClick={onReset} variant="destructive">
          Reset Database (Data Loss)
        </Button>
      </div>
    </div>
  );
};
