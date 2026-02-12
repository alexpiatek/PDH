import Head from 'next/head';
import type { NextPage } from 'next';

const featureCards = [
  {
    title: 'Hidden Discards',
    description:
      'You start with five cards, then trim one after each post-flop street. Everybody reaches showdown with two.',
  },
  {
    title: 'Live Multiplayer',
    description: 'Run real-time games in your browser with table state synchronized by an authoritative backend.',
  },
  {
    title: 'No Install',
    description: 'Jump into a table in seconds from desktop or mobile. Just open the site and pick a seat.',
  },
] as const;

const handFlow = [
  'Pre-flop: five private cards per player.',
  'Flop: betting round, then mandatory discard.',
  'Turn: betting round, then mandatory discard.',
  'River: betting round, then mandatory discard.',
  'Showdown: best hand using two hole cards + board.',
] as const;

const Home: NextPage = () => {
  const currentYear = new Date().getFullYear();

  return (
    <>
      <Head>
        <title>Bondi Poker | Discard Hold&apos;em</title>
        <meta
          name="description"
          content="Bondi Poker is fast online Discard Hold'em: classic betting with hidden post-flop discards and two-card showdown pressure."
        />
      </Head>

      <div className="page-shell">
        <div className="noise" aria-hidden="true" />

        <header className="topbar">
          <div className="brand-block">
            <p className="brand-kicker">Bondi Poker</p>
            <p className="brand-subtitle">Discard Hold&apos;em</p>
          </div>

          <a className="launch-link" href="/play">
            Enter Table
          </a>
        </header>

        <main>
          <section className="hero">
            <p className="hero-tag">NEW FORMAT. REAL PRESSURE.</p>
            <h1>Classic hold&apos;em rhythm, brutal hidden-card decisions.</h1>
            <p className="hero-copy">
              Bondi Poker adds mandatory discards after the flop, turn, and river. Every street tightens ranges and
              rewards strong reads.
            </p>

            <div className="hero-actions">
              <a className="cta-primary" href="/play">
                Play Now
              </a>
              <a className="cta-secondary" href="https://play.bondipoker.online">
                Open play.bondipoker.online
              </a>
            </div>
          </section>

          <section className="feature-grid" aria-label="Core features">
            {featureCards.map((card) => (
              <article key={card.title} className="feature-card">
                <h2>{card.title}</h2>
                <p>{card.description}</p>
              </article>
            ))}
          </section>

          <section className="flow-block" id="how-it-works">
            <h2>How a hand unfolds</h2>
            <ol>
              {handFlow.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="final-cta">
            <h2>Ready to pressure-test your range?</h2>
            <p>Launch a table and start playing Discard Hold&apos;em now.</p>
            <a className="cta-primary" href="/play">
              Launch Game
            </a>
          </section>
        </main>

        <footer className="footer">
          <p>&copy; {currentYear} Bondi Poker</p>
        </footer>
      </div>

      <style>{`
        body {
          margin: 0;
          background: radial-gradient(circle at 18% 22%, #f2f8e5 0%, #f4f6ea 35%, #ece5d6 100%);
          color: #182115;
          font-family: 'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        .page-shell {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          padding: 28px clamp(20px, 5vw, 72px) 56px;
        }

        .noise {
          position: absolute;
          inset: -160px;
          background:
            radial-gradient(circle at 25% 30%, rgba(255, 255, 255, 0.7) 0, rgba(255, 255, 255, 0) 44%),
            radial-gradient(circle at 78% 24%, rgba(161, 211, 116, 0.2) 0, rgba(161, 211, 116, 0) 52%),
            radial-gradient(circle at 70% 70%, rgba(196, 143, 79, 0.26) 0, rgba(196, 143, 79, 0) 48%);
          z-index: 0;
          animation: drift 10s ease-in-out infinite alternate;
          pointer-events: none;
        }

        .topbar,
        main,
        .footer {
          position: relative;
          z-index: 1;
          max-width: 1040px;
          margin: 0 auto;
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .brand-block {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .brand-kicker {
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-weight: 700;
          font-size: 0.76rem;
          color: #2f5030;
        }

        .brand-subtitle {
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-size: 0.8rem;
          font-weight: 600;
          color: #556a4d;
        }

        .launch-link {
          text-decoration: none;
          color: #11200c;
          background: #cce2a2;
          border: 1px solid #89ab55;
          padding: 10px 16px;
          border-radius: 999px;
          font-size: 0.9rem;
          font-weight: 700;
          transition: transform 160ms ease, box-shadow 160ms ease;
          white-space: nowrap;
        }

        .launch-link:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(63, 99, 46, 0.2);
        }

        main {
          padding-top: clamp(40px, 9vh, 92px);
          display: grid;
          gap: clamp(22px, 4.2vh, 44px);
        }

        .hero {
          max-width: 760px;
          animation: rise 600ms ease;
        }

        .hero-tag {
          margin: 0;
          font-size: 0.77rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #3f5a2d;
          font-weight: 700;
        }

        h1 {
          margin: 14px 0 0;
          font-family: 'Bebas Neue', 'Oswald', 'Franklin Gothic Medium', sans-serif;
          font-size: clamp(2.2rem, 6.6vw, 5rem);
          line-height: 0.95;
          letter-spacing: 0.01em;
          text-wrap: balance;
        }

        .hero-copy {
          margin: 16px 0 0;
          max-width: 64ch;
          font-size: clamp(1rem, 1.2vw, 1.16rem);
          line-height: 1.62;
          color: #32432a;
        }

        .hero-actions {
          margin-top: 28px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .cta-primary,
        .cta-secondary {
          text-decoration: none;
          border-radius: 999px;
          padding: 12px 20px;
          font-weight: 700;
          font-size: 0.92rem;
          transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
          text-align: center;
        }

        .cta-primary {
          background: #2f4f22;
          color: #f4fae7;
          box-shadow: 0 12px 30px rgba(27, 43, 18, 0.25);
        }

        .cta-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 14px 34px rgba(27, 43, 18, 0.3);
        }

        .cta-secondary {
          background: rgba(255, 255, 255, 0.78);
          color: #213719;
          border: 1px solid rgba(33, 55, 25, 0.24);
        }

        .cta-secondary:hover {
          background: rgba(255, 255, 255, 0.95);
          transform: translateY(-2px);
        }

        .feature-grid {
          display: grid;
          gap: 14px;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }

        .feature-card {
          border: 1px solid rgba(33, 53, 24, 0.2);
          border-radius: 16px;
          padding: 18px;
          background: rgba(255, 255, 255, 0.66);
          backdrop-filter: blur(1px);
          animation: rise 620ms ease;
        }

        .feature-card h2 {
          margin: 0;
          font-size: 1rem;
          color: #243620;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }

        .feature-card p {
          margin: 10px 0 0;
          font-size: 0.95rem;
          line-height: 1.5;
          color: #3d4f33;
        }

        .flow-block {
          padding: 24px;
          background: #151f14;
          color: #d9e9cf;
          border-radius: 20px;
          border: 1px solid #395136;
          box-shadow: 0 18px 44px rgba(23, 37, 16, 0.28);
        }

        .flow-block h2 {
          margin: 0;
          font-family: 'Bebas Neue', 'Oswald', 'Franklin Gothic Medium', sans-serif;
          letter-spacing: 0.02em;
          font-size: clamp(1.5rem, 2.8vw, 2.1rem);
        }

        .flow-block ol {
          margin: 14px 0 0;
          padding-left: 18px;
          display: grid;
          gap: 8px;
        }

        .flow-block li {
          line-height: 1.5;
          color: #e6f1df;
        }

        .final-cta {
          display: grid;
          gap: 8px;
          justify-items: start;
          padding: 14px 0 6px;
        }

        .final-cta h2 {
          margin: 0;
          font-family: 'Bebas Neue', 'Oswald', 'Franklin Gothic Medium', sans-serif;
          font-size: clamp(1.5rem, 3.6vw, 2.5rem);
          letter-spacing: 0.02em;
        }

        .final-cta p {
          margin: 0;
          font-size: 0.98rem;
          color: #32452a;
        }

        .footer {
          margin-top: 44px;
          border-top: 1px solid rgba(42, 64, 31, 0.2);
          padding-top: 16px;
        }

        .footer p {
          margin: 0;
          font-size: 0.83rem;
          color: #55684c;
        }

        @media (max-width: 720px) {
          .page-shell {
            padding-top: 20px;
          }

          .topbar {
            align-items: flex-start;
            flex-direction: column;
          }

          .launch-link {
            width: 100%;
          }

          .hero-actions {
            width: 100%;
          }

          .cta-primary,
          .cta-secondary {
            flex: 1;
            min-width: 100%;
          }
        }

        @keyframes drift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          100% {
            transform: translate3d(10px, -8px, 0) scale(1.03);
          }
        }

        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
};

export default Home;
