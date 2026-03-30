import { getDb } from '../db/index.js';
import { registerTool } from './registry.js';

// ── get_accounts ────────────────────────────────────────────────────

registerTool({
  name: 'get_accounts',
  description: 'List all linked bank accounts with current balances. Use when the user asks about their accounts, total balance, or when you need account IDs for other queries.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Filter by type: depository, credit, loan, investment' },
      classification: { type: 'string', description: 'Filter: asset or liability', enum: ['asset', 'liability'] },
    },
  },
  handler(args) {
    const db = getDb();
    let sql = 'SELECT id, name, type, subtype, classification, currency, current_balance, available_balance, institution_name, mask, source FROM accounts WHERE is_active = 1';
    const params: unknown[] = [];

    if (args.type) { sql += ' AND type = ?'; params.push(args.type); }
    if (args.classification) { sql += ' AND classification = ?'; params.push(args.classification); }
    sql += ' ORDER BY classification, current_balance DESC';

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({ ...r, current_balance: (r.current_balance as number) / 100, available_balance: r.available_balance != null ? (r.available_balance as number) / 100 : null }));
  },
});

// ── get_transactions ────────────────────────────────────────────────

registerTool({
  name: 'get_transactions',
  description: 'Search and retrieve bank transactions. Supports filtering by date range, account, category, merchant, amount range, and direction. Returns up to `limit` results.',
  parameters: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'Filter by account ID' },
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      category_slug: { type: 'string', description: 'Category slug e.g. food_and_drink' },
      merchant: { type: 'string', description: 'Merchant name (partial match)' },
      direction: { type: 'string', description: 'inflow, outflow, or transfer', enum: ['inflow', 'outflow', 'transfer'] },
      min_amount: { type: 'number', description: 'Minimum absolute amount in dollars' },
      max_amount: { type: 'number', description: 'Maximum absolute amount in dollars' },
      limit: { type: 'number', description: 'Max results (default 50)' },
    },
  },
  handler(args) {
    const db = getDb();
    let sql = `SELECT t.id, t.account_id, t.amount, t.date, t.name, t.merchant_name, t.direction, t.pending, t.note, t.plaid_category,
               c.slug as category_slug, c.name as category_name, a.name as account_name
               FROM transactions t
               LEFT JOIN categories c ON t.category_id = c.id
               LEFT JOIN accounts a ON t.account_id = a.id
               WHERE 1=1`;
    const params: unknown[] = [];

    if (args.account_id) { sql += ' AND t.account_id = ?'; params.push(args.account_id); }
    if (args.start_date) { sql += ' AND t.date >= ?'; params.push(args.start_date); }
    if (args.end_date) { sql += ' AND t.date <= ?'; params.push(args.end_date); }
    if (args.direction) { sql += ' AND t.direction = ?'; params.push(args.direction); }
    if (args.merchant) { sql += ' AND t.merchant_name LIKE ?'; params.push(`%${args.merchant}%`); }
    if (args.category_slug) {
      sql += ' AND (c.slug = ? OR c.slug LIKE ?)';
      params.push(args.category_slug, `${args.category_slug}.%`);
    }
    if (args.min_amount != null) { sql += ' AND ABS(t.amount) >= ?'; params.push(Math.round((args.min_amount as number) * 100)); }
    if (args.max_amount != null) { sql += ' AND ABS(t.amount) <= ?'; params.push(Math.round((args.max_amount as number) * 100)); }

    const limit = (args.limit as number) || 50;
    sql += ' ORDER BY t.date DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({ ...r, amount: (r.amount as number) / 100 }));
  },
});

// ── get_investments ─────────────────────────────────────────────────

registerTool({
  name: 'get_investments',
  description: 'Get investment holdings with security details, quantities, values, and cost basis. Use when the user asks about their portfolio or investments.',
  parameters: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'Filter by investment account ID' },
    },
  },
  handler(args) {
    const db = getDb();
    let sql = `SELECT h.id, h.account_id, h.quantity, h.cost_basis, h.value, h.price,
               s.ticker, s.name as security_name, s.type as security_type,
               a.name as account_name
               FROM holdings h
               JOIN securities s ON h.security_id = s.id
               JOIN accounts a ON h.account_id = a.id`;
    const params: unknown[] = [];
    if (args.account_id) { sql += ' WHERE h.account_id = ?'; params.push(args.account_id); }
    sql += ' ORDER BY h.value DESC';

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => ({
      ...r,
      value: (r.value as number) / 100,
      price: (r.price as number) / 100,
      cost_basis: r.cost_basis != null ? (r.cost_basis as number) / 100 : null,
    }));
  },
});

// ── get_recurring_transactions ──────────────────────────────────────

registerTool({
  name: 'get_recurring_transactions',
  description: 'Identify recurring transactions (subscriptions, bills, income) by grouping by name/merchant and detecting regular intervals. Use when analyzing fixed expenses or income patterns.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Filter: subscription, bill, or income', enum: ['subscription', 'bill', 'income'] },
      min_occurrences: { type: 'number', description: 'Minimum number of occurrences (default 3)' },
    },
  },
  handler(args) {
    const db = getDb();
    const minOcc = (args.min_occurrences as number) || 3;

    // Group by name+direction, find those with regular intervals
    const rows = db.prepare(`
      SELECT COALESCE(t.merchant_name, t.name) as merchant_name, t.direction, COUNT(*) as count,
             ROUND(AVG(ABS(t.amount))) as avg_amount,
             MIN(t.date) as first_date, MAX(t.date) as last_date,
             ABS(t.amount) as last_amount,
             c.slug as category_slug, c.name as category_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.direction != 'transfer'
      GROUP BY COALESCE(t.merchant_name, t.name), t.direction
      HAVING COUNT(*) >= ?
      ORDER BY AVG(ABS(amount)) DESC
    `).all(minOcc) as Record<string, unknown>[];

    let results = rows.map(r => {
      const count = r.count as number;
      const firstDate = new Date(r.first_date as string);
      const lastDate = new Date(r.last_date as string);
      const daySpan = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
      const avgInterval = count > 1 ? daySpan / (count - 1) : 0;

      let frequency = 'irregular';
      if (avgInterval >= 25 && avgInterval <= 35) frequency = 'monthly';
      else if (avgInterval >= 12 && avgInterval <= 16) frequency = 'biweekly';
      else if (avgInterval >= 5 && avgInterval <= 9) frequency = 'weekly';
      else if (avgInterval >= 80 && avgInterval <= 100) frequency = 'quarterly';

      const inferredType = (r.direction as string) === 'inflow' ? 'income' : (frequency === 'monthly' || frequency === 'weekly' ? 'subscription' : 'bill');

      return {
        merchant_name: r.merchant_name,
        type: inferredType,
        frequency,
        count,
        avg_amount: (r.avg_amount as number) / 100,
        last_amount: (r.last_amount as number) / 100,
        first_date: r.first_date,
        last_date: r.last_date,
        category_slug: r.category_slug,
        category_name: r.category_name,
      };
    });

    // Filter irregular out — only return things with detected frequency
    results = results.filter(r => r.frequency !== 'irregular');

    if (args.type) {
      results = results.filter(r => r.type === args.type);
    }

    return results;
  },
});
