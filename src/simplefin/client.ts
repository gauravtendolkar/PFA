/**
 * SimpleFIN API client.
 *
 * Users sign up at https://bridge.simplefin.org, connect their bank,
 * and get a one-time Setup Token. We claim it for a persistent Access URL,
 * then fetch accounts + transactions via HTTP Basic Auth.
 *
 * No developer registration, no API keys, no business verification.
 * Users pay SimpleFIN directly ($1.50/month).
 *
 * Protocol: https://simplefin.org/protocol.html
 */

export interface SFinAccount {
  id: string;
  name: string;
  conn_id: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  transactions?: SFinTransaction[];
}

export interface SFinTransaction {
  id: string;
  posted: number;        // UNIX timestamp, 0 = pending
  amount: string;        // signed numeric string
  description: string;
  transacted_at?: number;
  pending?: boolean;
}

export interface SFinConnection {
  conn_id: string;
  name: string;
}

export interface SFinAccountSet {
  errors: string[];
  accounts: SFinAccount[];
  connections?: SFinConnection[];
}

/**
 * Claim a one-time Setup Token → persistent Access URL.
 * The token is base64; decoded = a claim URL. POST to it returns the access URL.
 */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf-8');

  const res = await fetch(claimUrl, { method: 'POST' });
  if (res.status === 403) {
    throw new Error('Setup token already claimed or invalid. Generate a new one at SimpleFIN Bridge.');
  }
  if (!res.ok) {
    throw new Error(`Failed to claim token: ${res.status} ${res.statusText}`);
  }

  return (await res.text()).trim();
}

/** Parse access URL → base URL + Basic Auth header */
function parseAccessUrl(accessUrl: string): { baseUrl: string; auth: string } {
  const url = new URL(accessUrl);
  const auth = Buffer.from(`${url.username}:${url.password}`).toString('base64');
  url.username = '';
  url.password = '';
  return { baseUrl: url.toString().replace(/\/$/, ''), auth };
}

/** Fetch accounts (and optionally transactions) from SimpleFIN */
export async function fetchAccounts(
  accessUrl: string,
  opts?: { startDate?: Date; endDate?: Date; balancesOnly?: boolean },
): Promise<SFinAccountSet> {
  const { baseUrl, auth } = parseAccessUrl(accessUrl);

  const params = new URLSearchParams();
  params.set('version', '2');
  params.set('pending', '1');
  if (opts?.startDate) params.set('start-date', String(Math.floor(opts.startDate.getTime() / 1000)));
  if (opts?.endDate) params.set('end-date', String(Math.floor(opts.endDate.getTime() / 1000)));
  if (opts?.balancesOnly) params.set('balances-only', '1');

  const res = await fetch(`${baseUrl}/accounts?${params}`, {
    headers: { 'Authorization': `Basic ${auth}` },
  });

  if (res.status === 403) throw new Error('SimpleFIN access revoked. Generate a new Setup Token at bridge.simplefin.org.');
  if (res.status === 402) throw new Error('SimpleFIN subscription expired. Renew at bridge.simplefin.org.');
  if (!res.ok) throw new Error(`SimpleFIN API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return {
    errors: data.errors ?? data.errlist ?? [],
    accounts: data.accounts ?? [],
    connections: data.connections,
  };
}

export const SETUP_URL = 'https://bridge.simplefin.org/simplefin/create';
