import type { NextPageContext } from 'next';
import Head from 'next/head';
import { CoastalShell } from '../components/CoastalShell';

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
    <CoastalShell compactHeader>
      <Head>
        <title>{`${copy.title} | Bondi Poker`}</title>
      </Head>
      <main id="main-content" className="coastal-utility">
        <p className="coastal-eyebrow">
          {statusCode === 404 ? 'LET’S FIND YOUR TABLE' : 'BACK IN A MOMENT'}
        </p>
        <h1>{copy.title}</h1>
        <p>{copy.detail}</p>
        <a href="/play" className="coastal-button primary">
          Back to Lobby
        </a>
      </main>
    </CoastalShell>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};
