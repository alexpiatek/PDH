import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { FeatureFlagsProvider } from '../lib/featureFlags';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AppErrorBoundary>
      <FeatureFlagsProvider>
        <Component {...pageProps} />
      </FeatureFlagsProvider>
    </AppErrorBoundary>
  );
}
