import { useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const MATCH_ID_STORAGE_KEY = 'nakamaMatchId';

export default function TableRouteRedirectPage() {
  const router = useRouter();

  const matchId = useMemo(() => {
    const raw = router.query.matchId;
    if (typeof raw === 'string') {
      return raw;
    }
    if (Array.isArray(raw)) {
      return raw[0] ?? '';
    }
    return '';
  }, [router.query.matchId]);

  useEffect(() => {
    if (!router.isReady || !matchId) {
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MATCH_ID_STORAGE_KEY, matchId);
    }

    void router.replace('/game');
  }, [matchId, router]);

  return (
    <>
      <Head>
        <title>Joining Table...</title>
      </Head>
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0a1120',
          color: '#e4e7ee',
          fontFamily: 'Manrope, system-ui, sans-serif',
          padding: 24,
        }}
      >
        <p>Joining table...</p>
      </main>
    </>
  );
}
