import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import { registerTool } from './registry.js';

// ── update_transaction_category ─────────────────────────────────────

registerTool({
  name: 'update_transaction_category',
  description: 'Recategorize a transaction. Use when a transaction is miscategorized.',
  parameters: {
    type: 'object',
    properties: {
      transaction_id: { type: 'string', description: 'Transaction ID' },
      category_slug: { type: 'string', description: 'New category slug (e.g. food_and_drink.delivery)' },
    },
    required: ['transaction_id', 'category_slug'],
  },
  handler(args) {
    const db = getDb();
    const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(args.category_slug) as { id: string } | undefined;
    if (!cat) return { success: false, error: `Unknown category: ${args.category_slug}` };

    const result = db.prepare("UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE id = ?").run(cat.id, args.transaction_id);
    return { success: result.changes > 0 };
  },
});

// ── add_transaction_note ────────────────────────────────────────────

registerTool({
  name: 'add_transaction_note',
  description: 'Add a note to a transaction. Use when the user provides context about a transaction.',
  parameters: {
    type: 'object',
    properties: {
      transaction_id: { type: 'string', description: 'Transaction ID' },
      note: { type: 'string', description: 'Note text' },
    },
    required: ['transaction_id', 'note'],
  },
  handler(args) {
    const db = getDb();
    const result = db.prepare("UPDATE transactions SET note = ?, updated_at = datetime('now') WHERE id = ?").run(args.note, args.transaction_id);
    return { success: result.changes > 0 };
  },
});

// ── upsert_insight ──────────────────────────────────────────────────

registerTool({
  name: 'upsert_insight',
  description: 'Write a financial insight or tip to display on the dashboard. Use when you discover actionable patterns, spending spikes, or goal progress.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'tip, alert, trend, or milestone', enum: ['tip', 'alert', 'trend', 'milestone'] },
      title: { type: 'string', description: 'Short title' },
      body: { type: 'string', description: 'Detailed insight text' },
      priority: { type: 'string', description: 'low, medium, or high', enum: ['low', 'medium', 'high'] },
    },
    required: ['type', 'title', 'body'],
  },
  handler(args) {
    const db = getDb();
    const id = uuid();
    db.prepare('INSERT INTO insights (id, type, title, body, priority) VALUES (?, ?, ?, ?, ?)')
      .run(id, args.type, args.title, args.body, args.priority || 'medium');
    return { insight_id: id };
  },
});

// ── delete_insight ──────────────────────────────────────────────────

registerTool({
  name: 'delete_insight',
  description: 'Remove an insight from the dashboard.',
  parameters: {
    type: 'object',
    properties: {
      insight_id: { type: 'string', description: 'Insight ID to delete' },
    },
    required: ['insight_id'],
  },
  handler(args) {
    const db = getDb();
    const result = db.prepare('DELETE FROM insights WHERE id = ?').run(args.insight_id);
    return { success: result.changes > 0 };
  },
});

// ── crud_manual_asset ───────────────────────────────────────────────

registerTool({
  name: 'crud_manual_asset',
  description: 'Create, read, update, or delete a manually tracked asset or liability (house, car, crypto, etc.).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'read', 'update', 'delete'] },
      account_id: { type: 'string', description: 'Required for update/delete' },
      name: { type: 'string', description: 'Asset name (for create)' },
      type: { type: 'string', description: 'property, vehicle, crypto, other_asset, other_liability', enum: ['property', 'vehicle', 'crypto', 'other_asset', 'other_liability'] },
      value: { type: 'number', description: 'Value in dollars (for create/update)' },
    },
    required: ['action'],
  },
  handler(args) {
    const db = getDb();
    const { action, account_id } = args as Record<string, string>;

    switch (action) {
      case 'create': {
        const id = uuid();
        const classification = ['other_liability'].includes(args.type as string) ? 'liability' : 'asset';
        const balance = Math.round((args.value as number) * 100);
        db.prepare("INSERT INTO accounts (id, name, type, classification, current_balance, source) VALUES (?, ?, ?, ?, ?, 'manual')")
          .run(id, args.name, args.type, classification, balance);
        const today = new Date().toISOString().split('T')[0];
        db.prepare('INSERT INTO balance_history (account_id, date, balance) VALUES (?, ?, ?)').run(id, today, balance);
        return { account_id: id };
      }
      case 'read': {
        const where = account_id ? 'id = ?' : "source = 'manual'";
        const params = account_id ? [account_id] : [];
        const rows = db.prepare(`SELECT id, name, type, classification, current_balance FROM accounts WHERE ${where} AND is_active = 1`).all(...params) as Record<string, unknown>[];
        return rows.map(r => ({ ...r, current_balance: (r.current_balance as number) / 100 }));
      }
      case 'update': {
        if (!account_id) return { success: false, error: 'account_id required' };
        const updates: string[] = [];
        const params: unknown[] = [];
        if (args.name) { updates.push('name = ?'); params.push(args.name); }
        if (args.value != null) {
          const bal = Math.round((args.value as number) * 100);
          updates.push('current_balance = ?'); params.push(bal);
          const today = new Date().toISOString().split('T')[0];
          db.prepare('INSERT OR REPLACE INTO balance_history (account_id, date, balance) VALUES (?, ?, ?)').run(account_id, today, bal);
        }
        if (updates.length === 0) return { success: false, error: 'Nothing to update' };
        updates.push("updated_at = datetime('now')");
        params.push(account_id);
        db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        return { success: true };
      }
      case 'delete': {
        if (!account_id) return { success: false, error: 'account_id required' };
        db.prepare("UPDATE accounts SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(account_id);
        return { success: true };
      }
      default:
        return { error: `Unknown action: ${action}` };
    }
  },
});

// ── trigger_transaction_sync ────────────────────────────────────────

registerTool({
  name: 'trigger_transaction_sync',
  description: 'Trigger a fresh transaction sync from SimpleFIN. Use when the user asks to refresh their bank data.',
  parameters: {
    type: 'object',
    properties: {
      item_id: { type: 'string', description: 'Specific SimpleFIN item ID to sync (omit for all)' },
    },
  },
  async handler(args) {
    const { sync } = await import('../simplefin/sync.js');
    const results = await sync(args.item_id as string | undefined);
    if (results.length === 0) {
      return { error: 'No SimpleFIN connections found. Connect a bank account first via the Connect Account button.' };
    }
    return results.map(r => ({
      institution: r.institution,
      transactions_added: r.transactions.added,
      transactions_updated: r.transactions.updated,
      accounts_updated: r.accounts,
    }));
  },
});

// ── get_dashboard_data ──────────────────────────────────────────────

registerTool({
  name: 'get_dashboard_data',
  description: 'Get all data needed to render the financial dashboard: networth, accounts, recent transactions, insights.',
  parameters: {
    type: 'object',
    properties: {},
  },
  handler() {
    const db = getDb();

    const networth = db.prepare('SELECT * FROM networth_snapshots ORDER BY date DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    const accounts = db.prepare('SELECT id, name, type, classification, current_balance FROM accounts WHERE is_active = 1 ORDER BY classification, current_balance DESC').all() as Record<string, unknown>[];
    const recentTxns = db.prepare(`
      SELECT t.date, t.name, t.merchant_name, t.amount, t.direction, c.name as category
      FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
      ORDER BY t.date DESC LIMIT 20
    `).all() as Record<string, unknown>[];
    const insights = db.prepare("SELECT * FROM insights WHERE is_dismissed = 0 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY priority DESC, created_at DESC").all();
    const networthTrend = db.prepare('SELECT date, networth FROM networth_snapshots ORDER BY date DESC LIMIT 365').all() as Record<string, unknown>[];

    return {
      networth: networth ? { ...networth, networth: (networth.networth as number) / 100, total_assets: (networth.total_assets as number) / 100, total_liabilities: (networth.total_liabilities as number) / 100 } : null,
      accounts: accounts.map(a => ({ ...a, current_balance: (a.current_balance as number) / 100 })),
      recent_transactions: recentTxns.map(t => ({ ...t, amount: (t.amount as number) / 100 })),
      insights,
      networth_trend: networthTrend.map(r => ({ date: r.date, networth: (r.networth as number) / 100 })),
    };
  },
});
