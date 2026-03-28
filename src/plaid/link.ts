import { CountryCode, Products } from 'plaid';
import { v4 as uuid } from 'uuid';
import { getPlaidClient } from './client.js';
import { getDb } from '../db/index.js';

/** Create a link token for the Plaid Link UI */
export async function createLinkToken(userId: string = 'default'): Promise<string> {
  const client = getPlaidClient();

  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'PFA',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });

  return response.data.link_token;
}

/** Exchange a public token (from Plaid Link) for an access token and save the item */
export async function exchangePublicToken(publicToken: string): Promise<string> {
  const client = getPlaidClient();
  const db = getDb();

  // Exchange
  const exchangeRes = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const { access_token, item_id } = exchangeRes.data;

  // Get institution info
  const itemRes = await client.itemGet({ access_token });
  const institutionId = itemRes.data.item.institution_id;

  let institutionName: string | null = null;
  if (institutionId) {
    try {
      const instRes = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = instRes.data.institution.name;
    } catch {
      // Non-critical, continue without name
    }
  }

  // Save item
  const id = uuid();
  db.prepare(`
    INSERT INTO plaid_items (id, plaid_id, access_token, institution_id, institution_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, item_id, access_token, institutionId, institutionName);

  console.log('Linked item:', institutionName || item_id);

  // Immediately sync accounts
  await syncAccounts(id, access_token);

  return id;
}

/** Sync accounts from Plaid for a given item */
async function syncAccounts(itemId: string, accessToken: string): Promise<void> {
  const client = getPlaidClient();
  const db = getDb();

  const res = await client.accountsGet({ access_token: accessToken });

  const upsert = db.prepare(`
    INSERT INTO accounts (id, plaid_item_id, plaid_account_id, name, type, subtype, classification, currency, current_balance, available_balance, institution_name, mask, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid')
    ON CONFLICT(plaid_account_id) DO UPDATE SET
      name = excluded.name,
      current_balance = excluded.current_balance,
      available_balance = excluded.available_balance,
      updated_at = datetime('now')
  `);

  const balanceInsert = db.prepare(`
    INSERT OR REPLACE INTO balance_history (account_id, date, balance)
    VALUES (?, date('now'), ?)
  `);

  const institutionName = db.prepare('SELECT institution_name FROM plaid_items WHERE id = ?').get(itemId) as { institution_name: string | null } | undefined;

  const insertMany = db.transaction(() => {
    for (const acct of res.data.accounts) {
      const classification = getClassification(acct.type);
      const balance = Math.round((acct.balances.current ?? 0) * 100);
      const available = acct.balances.available != null ? Math.round(acct.balances.available * 100) : null;

      // For liabilities (credit cards, loans), Plaid reports positive balance = amount owed
      // We store as positive cents regardless — classification tells us how to interpret
      const id = getAccountId(db, acct.account_id) || uuid();

      upsert.run(
        id,
        itemId,
        acct.account_id,
        acct.name,
        acct.type,
        acct.subtype ?? null,
        classification,
        acct.balances.iso_currency_code ?? 'USD',
        balance,
        available,
        institutionName?.institution_name ?? null,
        acct.mask ?? null,
      );

      balanceInsert.run(id, balance);
    }
  });

  insertMany();
  console.log('Synced %d accounts', res.data.accounts.length);
}

function getClassification(type: string): 'asset' | 'liability' {
  if (type === 'credit' || type === 'loan') return 'liability';
  return 'asset';
}

function getAccountId(db: ReturnType<typeof getDb>, plaidAccountId: string): string | null {
  const row = db.prepare('SELECT id FROM accounts WHERE plaid_account_id = ?').get(plaidAccountId) as { id: string } | undefined;
  return row?.id ?? null;
}
