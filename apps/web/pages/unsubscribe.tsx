import Head from 'next/head';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { CoastalShell } from '../components/CoastalShell';

export default function UnsubscribePage() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const token = typeof router.query.token === 'string' ? router.query.token : '';
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  async function submit() {
    setStatus('loading');
    try {
      const response = await fetch(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed');
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }
  return (
    <CoastalShell compactHeader>
      <Head>
        <title>Unsubscribe | Bondi Poker</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
      <main id="main-content" className="coastal-utility">
        <p className="coastal-eyebrow">YOUR INBOX, YOUR CHOICE</p>
        <h1>Bondi Poker Emails</h1>
        {status === 'done' ? (
          <p role="status">You have been unsubscribed from Bondi Poker updates.</p>
        ) : (
          <>
            <p className="mb-5">
              {valid
                ? 'Stop receiving email updates from Bondi Poker?'
                : 'Open the unsubscribe link in your Bondi Poker email.'}
            </p>
            <button
              disabled={!valid || status === 'loading'}
              onClick={() => void submit()}
              className="coastal-button primary"
            >
              {status === 'loading' ? 'Unsubscribing...' : 'Unsubscribe'}
            </button>
            {status === 'error' ? (
              <p role="alert" className="mt-4 text-rose-200">
                Unable to unsubscribe. Please try again or email admin@bondipoker.com.
              </p>
            ) : null}
          </>
        )}
      </main>
    </CoastalShell>
  );
}
