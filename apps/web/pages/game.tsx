import { useEffect } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';

const MATCH_ID_STORAGE_KEY = 'nakamaMatchId';

const LegacyGameRoutePage: NextPage = () => {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    if (typeof window !== 'undefined') {
      const storedMatchId = window.localStorage.getItem(MATCH_ID_STORAGE_KEY);
      if (storedMatchId) {
        void router.replace(`/table/${encodeURIComponent(storedMatchId)}`);
        return;
      }
    }

    void router.replace('/play');
  }, [router]);

  return (
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
      Redirecting to lobby...
    </main>
  );
};

export default LegacyGameRoutePage;
