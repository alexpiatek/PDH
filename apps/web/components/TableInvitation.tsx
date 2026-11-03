import { useEffect, useState } from 'react';
import { Check, Copy, Users } from 'lucide-react';
import { inviteUrl } from '../lib/playIntent';
import { DISCORD_URL } from './CoastalShell';

export function TableInvitation({ code, playerCount }: { code: string; playerCount: number }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    setUrl(inviteUrl(window.location.origin, code));
    setCopied(false);
    setCopyError(false);
  }, [code]);
  return (
    <section className="coastal-waiting-room" aria-label="Invite friends to your table">
      <Users size={24} aria-hidden="true" />
      <h2>Bring your people.</h2>
      <p>{playerCount} of 9 seats filled. At least 2 players are needed to play.</p>
      <p>Send this link to your friends, or share your table code.</p>
      <p>
        Table code <strong>{code}</strong>
      </p>
      <input
        aria-label="Table invitation link"
        value={url}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        className="coastal-button primary"
        disabled={!url}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setCopyError(false);
          } catch {
            setCopyError(true);
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
        {copied ? 'Invite link copied' : 'Copy invite link'}
      </button>
      <p role="status">
        {copyError
          ? 'Select the link above and copy it to send your invitation.'
          : copied
            ? 'Ready to paste into your group chat.'
            : 'Anyone with your invite can join this table.'}
      </p>
      <a href="/practice" target="_blank" rel="noopener noreferrer">
        Try a practice hand while you wait
      </a>
      <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
        Find players in Discord
      </a>
      <a href="https://x.com/BondiPoker" target="_blank" rel="noopener noreferrer">
        X / @BondiPoker
      </a>
    </section>
  );
}
