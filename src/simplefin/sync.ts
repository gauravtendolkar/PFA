/**
 * SimpleFIN sync — accounts, transactions, balances, networth snapshot.
 *
 * Rate limit: 24 requests/day per access URL, 90-day max range per request.
 */
import { v4 as uuid } from 'uuid';
import { getDb, migrate } from '../db/index.js';
import { fetchAccounts, type SFinTransaction } from './client.js';

const TODAY = () => new Date().toISOString().split('T')[0];

interface SFinItem {
  id: string;
  access_url: string;
  institution_name: string | null;
  last_synced_at: string | null;
}

export interface SyncResult {
  itemId: string;
  institution: string | null;
  transactions: { added: number; updated: number };
  accounts: number;
}

export async function sync(itemId?: string): Promise<SyncResult[]> {
  const db = getDb();
  const results: SyncResult[] = [];

  const items: SFinItem[] = itemId
    ? (db.prepare('SELECT * FROM simplefin_items WHERE id = ? AND status = ?').all(itemId, 'active') as SFinItem[])
    : (db.prepare('SELECT * FROM simplefin_items WHERE status = ?').all('active') as SFinItem[]);

  if (items.length === 0) {
    console.log('No active SimpleFIN connections. Connect a bank account first.');
    return results;
  }

  for (const item of items) {
    try {
      const result = await syncItem(item);
      results.push(result);
    } catch (err: any) {
      console.error('SimpleFIN sync failed for', item.institution_name || item.id, err.message);
      db.prepare("UPDATE simplefin_items SET status = 'error', error_code = ?, updated_at = datetime('now') WHERE id = ?")
        .run(err.message.slice(0, 100), item.id);
    }
  }

  snapshotNetworth();
  return results;
}

async function syncItem(item: SFinItem): Promise<SyncResult> {
  const db = getDb();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90); // SimpleFIN max range

  const data = await fetchAccounts(item.access_url, { startDate });

  if (data.errors.length > 0) {
    console.warn('SimpleFIN warnings:', data.errors);
  }

  const connMap = new Map<string, string>();
  if (data.connections) {
    for (const c of data.connections) connMap.set(c.conn_id, c.name);
  }

  let acctCount = 0;
  let totalAdded = 0;
  let totalUpdated = 0;

  for (const acct of data.accounts) {
    const bal = Math.round(parseFloat(acct.balance) * 100);
    const avail = acct['available-balance'] ? Math.round(parseFloat(acct['available-balance']) * 100) : null;
    const connName = connMap.get(acct.conn_id) ?? item.institution_name ?? 'Unknown';

    const localAcct = db.prepare('SELECT id FROM accounts WHERE simplefin_account_id = ?').get(acct.id) as { id: string } | undefined;

    if (localAcct) {
      db.prepare("UPDATE accounts SET current_balance = ?, available_balance = ?, updated_at = datetime('now') WHERE id = ?")
        .run(Math.abs(bal), avail != null ? Math.abs(avail) : null, localAcct.id);
      db.prepare('INSERT OR REPLACE INTO balance_history (account_id, date, balance) VALUES (?, ?, ?)')
        .run(localAcct.id, TODAY(), Math.abs(bal));
    } else {
      const classification = bal < 0 ? 'liability' : 'asset';
      const type = classification === 'liability' ? 'credit' : 'depository';
      const id = uuid();
      db.prepare(`
        INSERT INTO accounts (id, simplefin_item_id, simplefin_account_id, name, type, classification, currency, current_balance, available_balance, institution_name, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'simplefin')
      `).run(id, item.id, acct.id, acct.name, type, classification, acct.currency || 'USD', Math.abs(bal), avail != null ? Math.abs(avail) : null, connName);
      db.prepare('INSERT OR REPLACE INTO balance_history (account_id, date, balance) VALUES (?, ?, ?)')
        .run(id, TODAY(), Math.abs(bal));
    }
    acctCount++;

    // Sync transactions
    if (acct.transactions) {
      const accountId = (db.prepare('SELECT id FROM accounts WHERE simplefin_account_id = ?').get(acct.id) as { id: string }).id;
      db.transaction(() => {
        for (const txn of acct.transactions!) {
          const result = upsertTxn(db, accountId, txn);
          if (result === 'added') totalAdded++;
          else if (result === 'updated') totalUpdated++;
        }
      })();
    }
  }

  db.prepare("UPDATE simplefin_items SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(item.id);

  console.log('  %s: %d accounts, txns +%d ~%d', item.institution_name, acctCount, totalAdded, totalUpdated);
  return { itemId: item.id, institution: item.institution_name, transactions: { added: totalAdded, updated: totalUpdated }, accounts: acctCount };
}

function upsertTxn(db: ReturnType<typeof getDb>, accountId: string, txn: SFinTransaction): 'added' | 'updated' | 'skipped' {
  const amountCents = Math.round(parseFloat(txn.amount) * 100);
  const direction = amountCents >= 0 ? 'inflow' : 'outflow';
  const absAmount = Math.abs(amountCents);
  const isPending = txn.pending || txn.posted === 0;
  const date = txn.transacted_at
    ? new Date(txn.transacted_at * 1000).toISOString().split('T')[0]
    : txn.posted > 0
      ? new Date(txn.posted * 1000).toISOString().split('T')[0]
      : TODAY();

  const sfinId = `sfin_${txn.id}`;
  const existing = db.prepare('SELECT id FROM transactions WHERE simplefin_id = ?').get(sfinId) as { id: string } | undefined;

  if (existing) {
    db.prepare(`UPDATE transactions SET amount = ?, date = ?, name = ?, direction = ?, pending = ?, updated_at = datetime('now') WHERE simplefin_id = ?`)
      .run(absAmount, date, txn.description, direction, isPending ? 1 : 0, sfinId);
    return 'updated';
  }

  db.prepare(`INSERT INTO transactions (id, account_id, simplefin_id, amount, date, name, direction, pending, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'simplefin')`)
    .run(uuid(), accountId, sfinId, absAmount, date, txn.description, direction, isPending ? 1 : 0);
  return 'added';
}

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
  const breakdown = JSON.stringify(accounts.map(a => ({ account_id: a.id, name: a.name, type: a.type, balance: a.current_balance })));

  db.prepare(`INSERT OR REPLACE INTO networth_snapshots (date, networth, total_assets, total_liabilities, breakdown) VALUES (?, ?, ?, ?, ?)`)
    .run(today, networth, totalAssets, totalLiabilities, breakdown);

  console.log('  networth: $%s', (networth / 100).toFixed(2));
}

// CLI entry point
const isDirectRun = process.argv[1] && (
  import.meta.url.endsWith(process.argv[1]) ||
  import.meta.url === `file://${process.argv[1]}`
);

if (isDirectRun) {
  migrate();
  sync().then(results => {
    if (results.length === 0) console.log('No items synced.');
    else for (const r of results) console.log('\n%s: %d accounts, txns +%d ~%d', r.institution || r.itemId, r.accounts, r.transactions.added, r.transactions.updated);
    process.exit(0);
  }).catch(err => { console.error('Sync error:', err); process.exit(1); });
}
