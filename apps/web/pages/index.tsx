import Head from 'next/head';
import type { NextPage } from 'next';
import HeroSection from '../components/HeroSection';

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>Bondi Poker | Discard Hold&apos;em</title>
        <meta
          name="description"
          content="Bondi Poker is the first poker game where you discard to survive. Build your hand street by street."
        />
      </Head>
      <HeroSection />
    </>
  );
};

export default Home;
