/**
 * SimpleFIN enrollment — claim setup tokens and persist access URLs.
 */
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import { claimSetupToken, fetchAccounts } from './client.js';

/**
 * Claim a setup token, save the access URL, and sync accounts.
 * Returns the local item ID.
 */
export async function claimAndSave(setupToken: string): Promise<string> {
  const accessUrl = await claimSetupToken(setupToken);

  // Fetch accounts (balances only) to discover institution name
  const data = await fetchAccounts(accessUrl, { balancesOnly: true });
  const institutionName = data.connections?.[0]?.name ?? 'SimpleFIN Bank';

  const db = getDb();
  const id = uuid();

  db.prepare(`
    INSERT INTO simplefin_items (id, access_url, institution_name)
    VALUES (?, ?, ?)
  `).run(id, accessUrl, institutionName);

  console.log('Linked SimpleFIN:', institutionName);

  // Build connection name map
  const connMap = new Map<string, string>();
  if (data.connections) {
    for (const c of data.connections) connMap.set(c.conn_id, c.name);
  }

  // Sync accounts into the accounts table
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, simplefin_item_id, simplefin_account_id, name, type, classification, currency, current_balance, available_balance, institution_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'simplefin')
    ON CONFLICT(simplefin_account_id) DO UPDATE SET
      name = excluded.name, current_balance = excluded.current_balance,
      available_balance = excluded.available_balance, updated_at = datetime('now')
  `);
  const balInsert = db.prepare(`INSERT OR REPLACE INTO balance_history (account_id, date, balance) VALUES (?, date('now'), ?)`);

  db.transaction(() => {
    for (const acct of data.accounts) {
      const bal = Math.round(parseFloat(acct.balance) * 100);
      const avail = acct['available-balance'] ? Math.round(parseFloat(acct['available-balance']) * 100) : null;
      const classification = bal < 0 ? 'liability' : 'asset';
      const type = classification === 'liability' ? 'credit' : 'depository';
      const connName = connMap.get(acct.conn_id) ?? institutionName;
      const accId = getExistingId(db, acct.id) || uuid();

      upsertAccount.run(accId, id, acct.id, acct.name, type, classification, acct.currency || 'USD', Math.abs(bal), avail != null ? Math.abs(avail) : null, connName);
      balInsert.run(accId, Math.abs(bal));
    }
  })();

  console.log('Synced %d accounts', data.accounts.length);
  return id;
}

function getExistingId(db: ReturnType<typeof getDb>, sfinId: string): string | null {
  const row = db.prepare('SELECT id FROM accounts WHERE simplefin_account_id = ?').get(sfinId) as { id: string } | undefined;
  return row?.id ?? null;
}
