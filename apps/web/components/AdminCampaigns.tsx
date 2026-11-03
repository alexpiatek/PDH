import { useEffect, useState } from 'react';
import { Eye, Mail, Save, Send, RefreshCw, Plus } from 'lucide-react';
import { fetchPlayerAdmin } from '../lib/nakamaClient';
import type { CampaignDashboard } from '../lib/campaigns';

const control = 'w-full rounded-md border border-white/20 bg-black/30 px-3 py-2 text-sm text-white';
const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/20 px-4 py-2 text-sm disabled:opacity-40';

export function AdminCampaigns() {
  const [data, setData] = useState<CampaignDashboard | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipient, setRecipient] = useState('admin@bondipoker.com');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selected = data?.campaigns.find((c) => c.id === id);
  const editable = !selected || selected.status === 'draft';
  async function load() {
    const response = await fetchPlayerAdmin('/api/admin/campaigns');
    const payload = await response.json();
    if (!response.ok) {
      setData(null);
      throw new Error(payload.error || 'Unable to load campaigns.');
    }
    setData(payload);
  }
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetchPlayerAdmin('/api/admin/campaigns');
        const payload = await response.json();
        if (!active) return;
        if (!response.ok) {
          setData(null);
          setError(payload.error || 'Unable to load campaigns.');
        } else setData(payload);
      } catch {
        if (active) setError('Unable to load campaigns.');
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function action(actionName: string) {
    setBusy(true);
    setMessage('');
    setError('');
    setConfirm(false);
    try {
      const response = await fetchPlayerAdmin('/api/admin/campaigns', {
        method: 'POST',
        body: { action: actionName, id, subject, body, recipient, audience: data?.audience },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Request failed.');
      if (actionName === 'save') {
        setId(payload.id);
        setDirty(false);
      }
      await load();
      setMessage(
        actionName === 'save'
          ? 'Draft saved.'
          : actionName === 'test'
            ? 'Test email accepted by the mail server. Check your inbox before sending.'
            : actionName === 'queue'
              ? 'Campaign queued.'
              : 'Remaining queued messages cancelled. An email already being sent may still go out.'
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeDraft(value: string) {
    if (dirty && !window.confirm('Discard the unsaved changes to this draft?')) return;
    const campaign = data?.campaigns.find((c) => c.id === value);
    setId(campaign?.id || null);
    setSubject(campaign?.subject || '');
    setBody(campaign?.body || '');
    setDirty(false);
    setConfirm(false);
    setMessage('');
    setError('');
  }
  return (
    <section aria-label="Email campaigns" className="border-t border-white/15 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Email Updates</h2>
        <button
          type="button"
          aria-label="Refresh campaigns"
          title="Refresh campaigns"
          disabled={busy}
          className={button}
          onClick={() => void load().catch((err) => setError(err.message))}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {data?.setupIssue ? (
        <p role="status" className="mb-4 text-amber-200">
          Sending unavailable: {data.setupIssue}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 text-rose-200">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mb-4 text-teal-200">
          {message}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3 text-sm text-zinc-300">
            <span>From: {data.sender}</span>
            <span>{data.audience} subscribed contacts included</span>
          </div>
          <div className="mb-5 flex gap-3">
            <select
              aria-label="Saved email campaigns"
              disabled={busy}
              value={id || ''}
              onChange={(e) => changeDraft(e.target.value)}
              className={control}
            >
              <option value="">New draft</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.subject} — {c.status}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => changeDraft('')}
            >
              <Plus size={16} />
              New
            </button>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <label className="block text-sm">
                Subject
                <input
                  className={`${control} mt-2`}
                  value={subject}
                  maxLength={180}
                  disabled={busy || !editable}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setDirty(true);
                    setConfirm(false);
                  }}
                />
              </label>
              <label className="block text-sm">
                Message
                <textarea
                  className={`${control} mt-2 min-h-64`}
                  value={body}
                  maxLength={20000}
                  disabled={busy || !editable}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setDirty(true);
                    setConfirm(false);
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy || !editable || !subject.trim() || !body.trim()}
                  onClick={() => void action('save')}
                  className={button}
                >
                  <Save size={16} />
                  Save Draft
                </button>
                <button
                  type="button"
                  aria-pressed={preview}
                  onClick={() => setPreview((value) => !value)}
                  className={button}
                >
                  <Eye size={16} />
                  Preview
                </button>
              </div>
              {editable ? (
                <>
                  <label className="block text-sm">
                    Test email address
                    <input
                      type="email"
                      className={`${control} mt-2`}
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !data.ready || !id || dirty}
                    onClick={() => void action('test')}
                    className={button}
                  >
                    <Mail size={16} />
                    Send Test
                  </button>
                  <div className="border-t border-white/15 pt-4">
                    <button
                      type="button"
                      disabled={busy || !data.ready || !selected?.tested || dirty || !data.audience}
                      onClick={() => setConfirm(true)}
                      className={`${button} border-teal-300/60 text-teal-100`}
                    >
                      <Send size={16} />
                      Review Send
                    </button>
                    {confirm ? (
                      <div
                        role="dialog"
                        aria-label="Confirm email campaign"
                        className="mt-4 rounded-md border border-amber-300/50 p-4"
                      >
                        <p className="break-words">
                          Send “{subject}” to {data.audience} subscribed contacts from {data.sender}
                          ?
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void action('queue')}
                            className={`${button} bg-teal-300 text-black`}
                          >
                            <Send size={16} />
                            Send to {data.audience} Subscribers
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm(false)}
                            className={button}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {selected ? (
                <div className="space-y-2 text-sm text-zinc-300">
                  <p>Status: {selected.status}</p>
                  <p>
                    {selected.accepted} accepted by mail server · {selected.pending} pending ·{' '}
                    {selected.sending} sending · {selected.failed} failed · {selected.unknown}{' '}
                    uncertain · {selected.skipped} skipped
                  </p>
                  {selected.unknown ? (
                    <p className="text-amber-200">
                      Uncertain attempts are not resent automatically. Check the mail provider
                      before sending again.
                    </p>
                  ) : null}
                  {selected.status === 'queued' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void action('cancel')}
                      className={button}
                    >
                      Cancel Remaining
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {preview ? (
              <div className="self-start rounded-md border border-white/20 bg-white p-5 text-zinc-900">
                <p className="text-sm text-zinc-500">Bondi Poker &lt;{data.sender}&gt;</p>
                <h3 className="my-4 break-words text-lg font-semibold">{subject || 'Subject'}</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">{body}</p>
                <div className="mt-8 border-t pt-4 text-xs text-zinc-500">
                  Bondi Poker
                  <br />
                  Unsubscribe
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
