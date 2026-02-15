import React, { type ErrorInfo, type ReactNode } from 'react';
import { logClientEvent } from '../lib/clientTelemetry';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logClientEvent(
      'ui.error_boundary',
      {
        message: error.message,
        name: error.name,
        componentStack: errorInfo.componentStack,
      },
      'error'
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: '#0f172a',
            color: '#e2e8f0',
            fontFamily: '"Inter", sans-serif',
            padding: 24,
            textAlign: 'center',
          }}
        >
          <div>
            <h1 style={{ marginBottom: 10, fontSize: 24 }}>Something went wrong</h1>
            <p style={{ margin: 0, opacity: 0.85 }}>
              The client hit an unexpected error. Reload the page and check browser logs for
              `ui.error_boundary`.
            </p>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
