import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PLAY_HOST = 'play.bondipoker.online';

const normalizeHost = (request: NextRequest) => {
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  return rawHost.split(',')[0]?.trim().toLowerCase().split(':')[0] || '';
};

const isPlayHost = (host: string) => {
  if (!host) return false;
  if (host === PLAY_HOST) return true;
  return host.startsWith('play.');
};

export function middleware(request: NextRequest) {
  const host = normalizeHost(request);

  if (request.nextUrl.pathname === '/' && isPlayHost(host)) {
    const rewrittenUrl = request.nextUrl.clone();
    rewrittenUrl.pathname = '/play';
    return NextResponse.rewrite(rewrittenUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/'],
};
