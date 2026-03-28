import { v4 as uuid } from 'uuid';
import { getPlaidClient } from './client.js';
import { getDb, migrate } from '../db/index.js';
import type { Transaction as PlaidTransaction, RemovedTransaction, Holding as PlaidHolding, Security as PlaidSecurity } from 'plaid';

const ONE_YEAR_AGO = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().split('T')[0];
};

const TODAY = () => new Date().toISOString().split('T')[0];

interface PlaidItem {
  id: string;
  plaid_id: string;
  access_token: string;
  sync_cursor: string | null;
  institution_name: string | null;
}

export interface SyncResult {
  itemId: string;
  institution: string | null;
  transactions: { added: number; modified: number; removed: number; pruned: number };
  accounts: number;
  holdings: number;
}

/**
 * Full sync: transactions (1yr), balances, holdings, networth snapshot.
 * Call daily or on webhook.
 */
export async function sync(itemId?: string): Promise<SyncResult[]> {
  invalidateSyncCaches();
  const db = getDb();
  const results: SyncResult[] = [];

  const items: PlaidItem[] = itemId
    ? (db.prepare('SELECT * FROM plaid_items WHERE id = ? AND status = ?').all(itemId, 'active') as PlaidItem[])
    : (db.prepare('SELECT * FROM plaid_items WHERE status = ?').all('active') as PlaidItem[]);

  if (items.length === 0) {
    console.log('No active items. Link an account first: npm run plaid:link');
    return results;
  }

  for (const item of items) {
    try {
      const result = await syncItem(item);
      results.push(result);
    } catch (err: any) {
      const plaidErr = err.response?.data;
      console.error('Sync failed for', item.institution_name || item.plaid_id, plaidErr || err.message);
      db.prepare("UPDATE plaid_items SET status = 'error', error_code = ?, updated_at = datetime('now') WHERE id = ?")
        .run(plaidErr?.error_code ?? 'UNKNOWN', item.id);
    }
  }

  // After all items synced, snapshot today's networth
  snapshotNetworth();

  return results;
}

async function syncItem(item: PlaidItem): Promise<SyncResult> {
  const txnResult = await syncTransactions(item);
  const acctCount = await syncBalances(item);
  const holdingsCount = await syncHoldings(item);
  const pruned = pruneOldTransactions();

  return {
    itemId: item.id,
    institution: item.institution_name,
    transactions: { ...txnResult, pruned },
    accounts: acctCount,
    holdings: holdingsCount,
  };
}

// ── Transactions (1 year only) ──────────────────────────────────────

async function syncTransactions(item: PlaidItem) {
  const client = getPlaidClient();
  const db = getDb();
  const cutoff = ONE_YEAR_AGO();

  let cursor = item.sync_cursor ?? undefined;
  let added: PlaidTransaction[] = [];
  let modified: PlaidTransaction[] = [];
  let removed: RemovedTransaction[] = [];
  let hasMore = true;

  while (hasMore) {
    const res = await client.transactionsSync({
      access_token: item.access_token,
      cursor,
    });
    added = added.concat(res.data.added);
    modified = modified.concat(res.data.modified);
    removed = removed.concat(res.data.removed);
    hasMore = res.data.has_more;
    cursor = res.data.next_cursor;
  }

  // Filter: only keep transactions within 1 year
  added = added.filter(t => t.date >= cutoff);
  modified = modified.filter(t => t.date >= cutoff);

  db.transaction(() => {
    for (const txn of added) upsertTransaction(db, txn);
    for (const txn of modified) upsertTransaction(db, txn);
    for (const txn of removed) {
      if (txn.transaction_id) {
        db.prepare('DELETE FROM transactions WHERE plaid_id = ?').run(txn.transaction_id);
      }
    }
    db.prepare("UPDATE plaid_items SET sync_cursor = ?, last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(cursor, item.id);
  })();

  console.log('  transactions: +%d ~%d -%d', added.length, modified.length, removed.length);
  return { added: added.length, modified: modified.length, removed: removed.length };
}

// Cached lookups — built once per sync, not per transaction
let accountCache: Map<string, string> | null = null;
let categoryCache: Map<string, string> | null = null;

function getAccountCache(db: ReturnType<typeof getDb>): Map<string, string> {
  if (!accountCache) {
    accountCache = new Map();
    const rows = db.prepare('SELECT id, plaid_account_id FROM accounts WHERE plaid_account_id IS NOT NULL').all() as { id: string; plaid_account_id: string }[];
    for (const r of rows) accountCache.set(r.plaid_account_id, r.id);
  }
  return accountCache;
}

function getCategoryCache(db: ReturnType<typeof getDb>): Map<string, string> {
  if (!categoryCache) {
    categoryCache = new Map();
    const rows = db.prepare('SELECT id, slug FROM categories').all() as { id: string; slug: string }[];
    for (const r of rows) categoryCache.set(r.slug, r.id);
  }
  return categoryCache;
}

function invalidateSyncCaches() {
  accountCache = null;
  categoryCache = null;
}

function upsertTransaction(db: ReturnType<typeof getDb>, txn: PlaidTransaction): void {
  const accounts = getAccountCache(db);
  const accountId = accounts.get(txn.account_id);
  if (!accountId) return;

  const amountCents = Math.round(txn.amount * 100);
  const direction = amountCents > 0 ? 'outflow' : amountCents < 0 ? 'inflow' : 'outflow';
  const plaidPrimary = txn.personal_finance_category?.primary ?? null;
  const plaidDetailed = txn.personal_finance_category?.detailed ?? null;
  const plaidCategory = plaidDetailed ?? plaidPrimary ?? txn.category?.join('.') ?? null;
  const categoryId = mapPlaidCategoryFast(plaidPrimary, plaidDetailed);

  db.prepare(`
    INSERT INTO transactions (id, account_id, plaid_id, amount, date, name, merchant_name, category_id, plaid_category, direction, pending, payment_channel, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid')
    ON CONFLICT(plaid_id) DO UPDATE SET
      amount = excluded.amount, date = excluded.date, name = excluded.name,
      merchant_name = excluded.merchant_name, plaid_category = excluded.plaid_category,
      category_id = COALESCE(transactions.category_id, excluded.category_id),
      direction = excluded.direction, pending = excluded.pending, updated_at = datetime('now')
  `).run(
    uuid(), accountId, txn.transaction_id, amountCents, txn.date,
    txn.name, txn.merchant_name ?? null, categoryId, plaidCategory,
    direction, txn.pending ? 1 : 0, txn.payment_channel ?? null,
  );
}

const DETAILED_MAP: Record<string, string> = {
  'food_and_drink_restaurants': 'food_and_drink.restaurant',
  'food_and_drink_groceries': 'food_and_drink.groceries',
  'food_and_drink_coffee': 'food_and_drink.coffee',
  'food_and_drink_fast_food': 'food_and_drink.delivery',
  'entertainment_music_and_audio': 'entertainment.streaming',
  'entertainment_tv_and_movies': 'entertainment.streaming',
  'entertainment_sporting_events_and_concerts': 'entertainment.events',
  'entertainment_games': 'entertainment.games',
  'transportation_gas': 'transportation.gas',
  'transportation_parking': 'transportation.parking',
  'transportation_taxis_and_ride_shares': 'transportation.rideshare',
  'transportation_public_transit': 'transportation.public',
  'rent_and_utilities_rent': 'housing.rent',
  'rent_and_utilities_utilities': 'housing.utilities',
  'medical_medical_services': 'health.medical',
  'medical_pharmacies': 'health.pharmacy',
  'personal_care_gyms_and_fitness': 'health.fitness',
  'income_wages': 'income.salary',
  'income_dividends': 'income.investment',
};

const PRIMARY_MAP: Record<string, string> = {
  'food_and_drink': 'food_and_drink',
  'entertainment': 'entertainment',
  'transportation': 'transportation',
  'travel': 'personal.travel',
  'transfer_out': 'other_expense',
  'transfer_in': 'income.other',
  'general_merchandise': 'shopping.general',
  'rent_and_utilities': 'housing',
  'personal_care': 'personal',
  'income': 'income.salary',
  'loan_payments': 'other_expense',
  'general_services': 'personal',
  'government_and_non_profit': 'other_expense',
  'medical': 'health',
  'bank_fees': 'fees.bank',
};

/** Map Plaid category to our category_id using in-memory cache (no DB queries) */
function mapPlaidCategoryFast(primary: string | null, detailed: string | null): string | null {
  if (!primary) return null;
  const cats = getCategoryCache(getDb());
  const d = detailed?.toLowerCase() ?? '';
  const p = primary.toLowerCase();

  if (d) {
    const slug = DETAILED_MAP[d];
    if (slug && cats.has(slug)) return cats.get(slug)!;
  }
  const slug = PRIMARY_MAP[p];
  if (slug && cats.has(slug)) return cats.get(slug)!;
  return null;
}

/** Delete transactions older than 1 year */
function pruneOldTransactions(): number {
  const db = getDb();
  const cutoff = ONE_YEAR_AGO();
  const result = db.prepare("DELETE FROM transactions WHERE date < ? AND source = 'plaid'").run(cutoff);
  if (result.changes > 0) console.log('  pruned %d old transactions (before %s)', result.changes, cutoff);
  return result.changes;
}

// ── Balances ────────────────────────────────────────────────────────

async function syncBalances(item: PlaidItem): Promise<number> {
  const client = getPlaidClient();
  const db = getDb();
  const today = TODAY();

  const res = await client.accountsGet({ access_token: item.access_token });

  db.transaction(() => {
    for (const acct of res.data.accounts) {
      const balance = Math.round((acct.balances.current ?? 0) * 100);
      const available = acct.balances.available != null ? Math.round(acct.balances.available * 100) : null;

      db.prepare("UPDATE accounts SET current_balance = ?, available_balance = ?, updated_at = datetime('now') WHERE plaid_account_id = ?")
        .run(balance, available, acct.account_id);

      const localAcct = db.prepare('SELECT id FROM accounts WHERE plaid_account_id = ?').get(acct.account_id) as { id: string } | undefined;
      if (localAcct) {
        db.prepare('INSERT OR REPLACE INTO balance_history (account_id, date, balance) VALUES (?, ?, ?)')
          .run(localAcct.id, today, balance);
      }
    }
  })();

  console.log('  balances: %d accounts updated', res.data.accounts.length);
  return res.data.accounts.length;
}

// ── Holdings (investments) ──────────────────────────────────────────

async function syncHoldings(item: PlaidItem): Promise<number> {
  const client = getPlaidClient();
  const db = getDb();

  // Only sync if this item has investment accounts
  const hasInvestment = db.prepare("SELECT 1 FROM accounts WHERE plaid_item_id = ? AND type = 'investment' LIMIT 1").get(item.id);
  if (!hasInvestment) return 0;

  let holdings: PlaidHolding[] = [];
  let securities: PlaidSecurity[] = [];

  try {
    const res = await client.investmentsHoldingsGet({ access_token: item.access_token });
    holdings = res.data.holdings;
    securities = res.data.securities;
  } catch (err: any) {
    // PRODUCTS_NOT_READY or NO_INVESTMENT_ACCOUNTS is fine
    if (err.response?.data?.error_code === 'PRODUCTS_NOT_READY') return 0;
    if (err.response?.data?.error_code === 'NO_INVESTMENT_ACCOUNTS') return 0;
    throw err;
  }

  db.transaction(() => {
    // Upsert securities
    for (const sec of securities) {
      db.prepare(`
        INSERT INTO securities (id, plaid_security_id, ticker, name, type)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(plaid_security_id) DO UPDATE SET
          ticker = excluded.ticker, name = excluded.name, type = excluded.type, updated_at = datetime('now')
      `).run(uuid(), sec.security_id, sec.ticker_symbol ?? null, sec.name ?? 'Unknown', sec.type ?? null);
    }

    // Delete old holdings for accounts in this item, replace with fresh
    const accountIds = db.prepare('SELECT id FROM accounts WHERE plaid_item_id = ?').all(item.id) as { id: string }[];
    for (const { id } of accountIds) {
      db.prepare('DELETE FROM holdings WHERE account_id = ?').run(id);
    }

    // Insert current holdings
    for (const h of holdings) {
      const account = db.prepare('SELECT id FROM accounts WHERE plaid_account_id = ?').get(h.account_id) as { id: string } | undefined;
      const security = db.prepare('SELECT id FROM securities WHERE plaid_security_id = ?').get(h.security_id) as { id: string } | undefined;
      if (!account || !security) continue;

      const price = Math.round((h.institution_price ?? 0) * 100);
      const value = Math.round((h.institution_value ?? 0) * 100);
      const costBasis = h.cost_basis != null ? Math.round(h.cost_basis * 100) : null;

      db.prepare('INSERT INTO holdings (id, account_id, security_id, quantity, cost_basis, value, price) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), account.id, security.id, h.quantity, costBasis, value, price);
    }
  })();

  console.log('  holdings: %d positions, %d securities', holdings.length, securities.length);
  return holdings.length;
}

// ── Networth snapshot ───────────────────────────────────────────────

function snapshotNetworth(): void {
  const db = getDb();
  const today = TODAY();

  const accounts = db.prepare("SELECT id, name, type, classification, current_balance FROM accounts WHERE is_active = 1").all() as {
    id: string; name: string; type: string; classification: string; current_balance: number;
  }[];

  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const a of accounts) {
    if (a.classification === 'asset') totalAssets += a.current_balance;
    else totalLiabilities += a.current_balance;
  }

  const networth = totalAssets - totalLiabilities;
  const breakdown = JSON.stringify(accounts.map(a => ({
    account_id: a.id, name: a.name, type: a.type, balance: a.current_balance,
  })));

  db.prepare(`
    INSERT OR REPLACE INTO networth_snapshots (date, networth, total_assets, total_liabilities, breakdown)
    VALUES (?, ?, ?, ?, ?)
  `).run(today, networth, totalAssets, totalLiabilities, breakdown);

  console.log('  networth: $%s (assets $%s - liabilities $%s)',
    (networth / 100).toFixed(2),
    (totalAssets / 100).toFixed(2),
    (totalLiabilities / 100).toFixed(2),
  );
}

// ── CLI entry point ─────────────────────────────────────────────────

const isDirectRun = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1]) ||
  import.meta.url === `file://${process.argv[1]}`
);

if (isDirectRun) {
  migrate();
  sync().then(results => {
    if (results.length === 0) {
      console.log('No items synced. Link an account first: npm run plaid:link');
    } else {
      for (const r of results) {
        console.log('\n%s:', r.institution || r.itemId);
        console.log('  %d accounts, %d holdings', r.accounts, r.holdings);
        console.log('  txns: +%d ~%d -%d (pruned %d)',
          r.transactions.added, r.transactions.modified, r.transactions.removed, r.transactions.pruned);
      }
    }
    process.exit(0);
  }).catch(err => {
    console.error('Sync error:', err);
    process.exit(1);
  });
}
