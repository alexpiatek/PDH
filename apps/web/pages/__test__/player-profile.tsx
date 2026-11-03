import type { GetServerSideProps } from 'next';
import { PlayerProfileView } from '../../components/PlayerProfileView';

export const getServerSideProps: GetServerSideProps = async () => {
  if (process.env.PDH_ENABLE_TEST_POKER_STATE !== '1') return { notFound: true };
  return { props: {} };
};

// Local visual review only. No session, network actions or account balances are used.
export default function PlayerProfilePreview() {
  return (
    <PlayerProfileView
      profile={{
        displayName: 'Alex',
        availableChips: 12400,
        handsStarted: 24,
        handsCompleted: 23,
        handsWon: 8,
        netWinnings: 2400,
        tableSessions: 4,
        freeTopUps: 0,
        freeChipsGranted: 10000,
        tableRebuys: 1,
        allocation: null,
      }}
      error=""
      busy={false}
      retryTopUp={false}
      onTopUp={async () => {}}
      onPasswordChange={async () => {}}
      onSignOut={() => {}}
    />
  );
}
