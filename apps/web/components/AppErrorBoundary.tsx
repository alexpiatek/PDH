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
            <h1 style={{ marginBottom: 10, fontSize: 24 }}>Table screen had a problem</h1>
            <p style={{ margin: 0, opacity: 0.85 }}>
              Reload the page, or return to the lobby and rejoin the table.
            </p>
            <a
              href="/play"
              style={{
                display: 'inline-flex',
                marginTop: 18,
                minHeight: 42,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                border: '1px solid rgba(94,234,212,0.68)',
                padding: '0 16px',
                color: '#ccfbf1',
                textDecoration: 'none',
                fontWeight: 700,
              }}
            >
              Back to Lobby
            </a>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
