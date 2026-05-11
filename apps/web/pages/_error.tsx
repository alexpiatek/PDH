import type { NextPageContext } from 'next';
import Head from 'next/head';
import { BondiPokerLogo } from '../components/BondiPokerLogo';

interface ErrorPageProps {
  statusCode?: number;
}

function copyForStatus(statusCode?: number) {
  if (statusCode === 404) {
    return {
      title: 'Table not found',
      detail: 'That page or table code is no longer available.',
    };
  }
  if (statusCode === 500) {
    return {
      title: 'Table service had a problem',
      detail: 'The table service returned an error. Try again from the lobby.',
    };
  }
  return {
    title: 'Something went wrong',
    detail: statusCode
      ? `The app returned HTTP ${statusCode}. Try again from the lobby.`
      : 'The app hit an unexpected problem. Try again from the lobby.',
  };
}

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  const copy = copyForStatus(statusCode);

  return (
    <>
      <Head>
        <title>{copy.title} | Bondi Poker</title>
      </Head>
      <main className="grid min-h-screen place-items-center bg-[#03080b] px-6 text-center text-zinc-100">
        <div className="w-full max-w-md rounded-lg border border-white/15 bg-zinc-950/[0.72] px-6 py-7 shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
          <BondiPokerLogo variant="lockup" className="mx-auto w-24" />
          <div className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
            {statusCode ? `HTTP ${statusCode}` : 'App error'}
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-white">{copy.title}</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{copy.detail}</p>
          <a
            href="/play"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md border border-teal-200/70 bg-teal-400/[0.28] px-5 text-sm font-semibold text-teal-50 transition hover:bg-teal-300/[0.42]"
          >
            Back to Lobby
          </a>
        </div>
      </main>
    </>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};
