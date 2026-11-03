import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { fetchPlayerAdmin } from '../lib/nakamaClient';
import type { EarlyAccessSignupPage } from '../lib/earlyAccessServer';

export function AdminSignupList() {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<EarlyAccessSignupPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError('');
    void fetchPlayerAdmin(`/api/admin/early-access?page=${page}`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401 || response.status === 403
              ? 'Administrator sign-in is required.'
              : 'Signup list is unavailable. Please try again.'
          );
        const payload = (await response.json()) as EarlyAccessSignupPage;
        if (!cancelled) setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, refresh]);

  return (
    <section className="border-t border-white/15 py-6" aria-label="Email signups">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Email Signups {data ? `(${data.total})` : ''}</h2>
        <button
          type="button"
          aria-label="Refresh email signups"
          title="Refresh email signups"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
          className="grid h-10 w-10 place-items-center rounded-md border border-white/20 disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {loading ? <p role="status">Loading signups...</p> : null}
      {error ? (
        <p role="alert" className="text-rose-200">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-400">
                <tr>
                  {['Email', 'Name', 'Signed Up', 'Consent', 'Status', 'Source'].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="border-b border-white/15 px-3 py-3 font-medium"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.signups.map((signup) => (
                  <tr key={signup.email}>
                    <td className="break-all border-b border-white/10 px-3 py-3">{signup.email}</td>
                    <td className="border-b border-white/10 px-3 py-3">{signup.name || '-'}</td>
                    <td className="whitespace-nowrap border-b border-white/10 px-3 py-3">
                      {new Date(signup.createdAt).toLocaleString()}
                    </td>
                    <td className="border-b border-white/10 px-3 py-3">
                      {signup.marketingConsent ? 'Yes' : 'No'}
                    </td>
                    <td className="border-b border-white/10 px-3 py-3">
                      {signup.unsubscribedAt ? 'Unsubscribed' : 'Subscribed'}
                    </td>
                    <td className="border-b border-white/10 px-3 py-3">{signup.source || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.signups.length ? <p className="py-4 text-zinc-400">No signups found.</p> : null}
          <div className="mt-4 flex items-center justify-end gap-3 text-sm">
            <button
              type="button"
              aria-label="Previous signup page"
              title="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="grid h-10 w-10 place-items-center rounded-md border border-white/20 disabled:opacity-30"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(data.total / 50))}
            </span>
            <button
              type="button"
              aria-label="Next signup page"
              title="Next page"
              disabled={page * 50 >= data.total}
              onClick={() => setPage((value) => value + 1)}
              className="grid h-10 w-10 place-items-center rounded-md border border-white/20 disabled:opacity-30"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
