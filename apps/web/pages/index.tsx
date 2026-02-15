import Head from 'next/head';
import type { NextPage } from 'next';
import HeroSection from '../components/HeroSection';

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>BondiPoker - Hold&apos;em with Hidden Discards</title>
        <meta
          name="description"
          content="Real-time multiplayer poker with a twist: start with 5 hole cards, discard 1 after flop/turn/river, and reach a 2-card showdown."
        />
      </Head>
      <HeroSection />
    </>
  );
};

export default Home;
