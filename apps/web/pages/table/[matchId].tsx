import { useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import PokerGamePage from '../../components/PokerGamePage';
import { BondiPokerLogo } from '../../components/BondiPokerLogo';

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
        <main className="grid min-h-screen place-items-center bg-[#03080b] px-6 text-center text-zinc-100">
          <div className="rounded-lg border border-amber-300/35 bg-zinc-950/[0.62] px-6 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
            <BondiPokerLogo variant="lockup" className="mx-auto w-20" />
            <div className="mt-3 text-sm text-zinc-300">Loading table...</div>
          </div>
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
