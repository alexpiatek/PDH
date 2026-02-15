import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { AppErrorBoundary } from '../components/AppErrorBoundary';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AppErrorBoundary>
      <Component {...pageProps} />
    </AppErrorBoundary>
  );
}
