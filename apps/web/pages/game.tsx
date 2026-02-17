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
      Redirecting to game entry...
    </main>
  );
};

export default LegacyGameRoutePage;
