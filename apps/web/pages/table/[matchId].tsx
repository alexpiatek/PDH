import { useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import PokerGamePage from '../../components/PokerGamePage';

export default function TableMatchPage() {
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

  if (!router.isReady || !matchId) {
    return (
      <>
        <Head>
          <title>Loading Table...</title>
        </Head>
        <main
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: '#0a1120',
            color: '#e4e7ee',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          Loading table...
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Bondi Poker Table</title>
      </Head>
      <PokerGamePage forcedMatchId={matchId} onExitLobby={() => void router.push('/play')} />
    </>
  );
}
