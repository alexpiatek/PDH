import { useEffect } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';

const LegacyGameRoutePage: NextPage = () => {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    void router.replace('/play');
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#03080b] px-6 text-center text-zinc-100">
      <div className="rounded-lg border border-amber-300/35 bg-zinc-950/[0.62] px-6 py-5 shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
        <div className="font-[var(--font-display)] text-xs font-semibold uppercase tracking-[0.32em] text-amber-200">
          Bondi Poker
        </div>
        <div className="mt-3 text-sm text-zinc-300">Redirecting to game entry...</div>
      </div>
    </main>
  );
};

export default LegacyGameRoutePage;
