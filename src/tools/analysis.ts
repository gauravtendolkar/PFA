import { getDb } from '../db/index.js';
import { registerTool } from './registry.js';

// ── compute_spending_summary ────────────────────────────────────────

registerTool({
  name: 'compute_spending_summary',
  description: 'Calculate total spending broken down by category for a date range. Use when the user asks "where does my money go?" or wants a spending breakdown.',
  parameters: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      account_id: { type: 'string', description: 'Filter by account ID' },
      group_by: { type: 'string', description: 'Group by: category, merchant, week, month', enum: ['category', 'merchant', 'week', 'month'] },
    },
    required: ['start_date', 'end_date'],
  },
  handler(args) {
    const db = getDb();
    const { start_date, end_date, account_id, group_by = 'category' } = args as Record<string, string>;

    let groupCol: string;
    let groupName: string;
    let joins = '';

    switch (group_by) {
      case 'merchant':
        groupCol = 't.merchant_name'; groupName = 'merchant_name'; break;
      case 'week':
        groupCol = "strftime('%Y-W%W', t.date)"; groupName = 'week'; break;
      case 'month':
        groupCol = "strftime('%Y-%m', t.date)"; groupName = 'month'; break;
      default:
        groupCol = "COALESCE(pc.name, c.name, 'Uncategorized')";
        groupName = 'category';
        joins = `LEFT JOIN categories c ON t.category_id = c.id LEFT JOIN categories pc ON c.parent_id = pc.id`;
    }

    let where = "t.direction = 'outflow' AND t.date >= ? AND t.date <= ?";
    const params: unknown[] = [start_date, end_date];
    if (account_id) { where += ' AND t.account_id = ?'; params.push(account_id); }

    const rows = db.prepare(`
      SELECT ${groupCol} as name, SUM(t.amount) as total, COUNT(*) as transaction_count
      FROM transactions t ${joins}
      WHERE ${where}
      GROUP BY ${groupCol}
      ORDER BY SUM(t.amount) DESC
    `).all(...params) as { name: string | null; total: number; transaction_count: number }[];

    const grandTotal = rows.reduce((s, r) => s + r.total, 0);

    return {
      total: grandTotal / 100,
      groups: rows.map(r => ({
        name: r.name || 'Unknown',
        amount: r.total / 100,
        percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 1000) / 10 : 0,
        transaction_count: r.transaction_count,
      })),
    };
  },
});

// ── compute_income_summary ──────────────────────────────────────────

registerTool({
  name: 'compute_income_summary',
  description: 'Calculate total income broken down by source for a date range. Use when analyzing earnings or computing savings rate.',
  parameters: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      group_by: { type: 'string', description: 'Group by: source, month, account', enum: ['source', 'month', 'account'] },
    },
    required: ['start_date', 'end_date'],
  },
  handler(args) {
    const db = getDb();
    const { start_date, end_date, group_by = 'source' } = args as Record<string, string>;

    let groupCol: string;
    let joins = '';

    switch (group_by) {
      case 'month': groupCol = "strftime('%Y-%m', t.date)"; break;
      case 'account': groupCol = 'a.name'; joins = 'LEFT JOIN accounts a ON t.account_id = a.id'; break;
      default: groupCol = "COALESCE(t.merchant_name, c.name, 'Unknown')"; joins = 'LEFT JOIN categories c ON t.category_id = c.id'; break;
    }

    const rows = db.prepare(`
      SELECT ${groupCol} as name, SUM(ABS(t.amount)) as total, COUNT(*) as count
      FROM transactions t ${joins}
      WHERE t.direction = 'inflow' AND t.date >= ? AND t.date <= ?
      GROUP BY ${groupCol}
      ORDER BY SUM(ABS(t.amount)) DESC
    `).all(start_date, end_date) as { name: string | null; total: number; count: number }[];

    const grandTotal = rows.reduce((s, r) => s + r.total, 0);

    return {
      total: grandTotal / 100,
      sources: rows.map(r => ({
        name: r.name || 'Unknown',
        amount: r.total / 100,
        percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 1000) / 10 : 0,
        count: r.count,
      })),
    };
  },
});

// ── compute_savings_rate ────────────────────────────────────────────

registerTool({
  name: 'compute_savings_rate',
  description: 'Calculate savings rate (income - spending) / income for a period. Use when the user asks how much they are saving.',
  parameters: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      interval: { type: 'string', description: 'Break down by: monthly, quarterly, or total', enum: ['monthly', 'quarterly', 'total'] },
    },
    required: ['start_date', 'end_date'],
  },
  handler(args) {
    const db = getDb();
    const { start_date, end_date, interval = 'total' } = args as Record<string, string>;

    const groupExpr = interval === 'monthly' ? "strftime('%Y-%m', date)" : interval === 'quarterly' ? "strftime('%Y', date) || '-Q' || ((CAST(strftime('%m', date) AS INTEGER) - 1) / 3 + 1)" : "'total'";

    const rows = db.prepare(`
      SELECT ${groupExpr} as period,
             SUM(CASE WHEN direction = 'inflow' THEN ABS(amount) ELSE 0 END) as income,
             SUM(CASE WHEN direction = 'outflow' THEN amount ELSE 0 END) as spending
      FROM transactions
      WHERE date >= ? AND date <= ? AND direction != 'transfer'
      GROUP BY ${groupExpr}
      ORDER BY period
    `).all(start_date, end_date) as { period: string; income: number; spending: number }[];

    const periods = rows.map(r => {
      const income = r.income / 100;
      const spending = r.spending / 100;
      const savings = income - spending;
      return {
        period: r.period,
        income,
        spending,
        savings,
        savings_rate_pct: income > 0 ? Math.round((savings / income) * 1000) / 10 : 0,
      };
    });

    const totalIncome = periods.reduce((s, p) => s + p.income, 0);
    const totalSpending = periods.reduce((s, p) => s + p.spending, 0);

    return {
      periods,
      average_savings_rate_pct: totalIncome > 0 ? Math.round(((totalIncome - totalSpending) / totalIncome) * 1000) / 10 : 0,
    };
  },
});

// ── compute_networth ────────────────────────────────────────────────

registerTool({
  name: 'compute_networth',
  description: 'Calculate current networth: total assets minus total liabilities, broken down by account.',
  parameters: {
    type: 'object',
    properties: {},
  },
  handler() {
    const db = getDb();
    const accounts = db.prepare('SELECT id, name, type, classification, current_balance FROM accounts WHERE is_active = 1').all() as {
      id: string; name: string; type: string; classification: string; current_balance: number;
    }[];

    let assets = 0, liabilities = 0;
    const breakdown = accounts.map(a => {
      const bal = a.current_balance / 100;
      if (a.classification === 'asset') assets += bal; else liabilities += bal;
      return { account_id: a.id, name: a.name, type: a.type, classification: a.classification, balance: bal };
    });

    return { networth: assets - liabilities, total_assets: assets, total_liabilities: liabilities, breakdown };
  },
});

// ── compute_networth_trend ──────────────────────────────────────────

registerTool({
  name: 'compute_networth_trend',
  description: 'Get networth over time from daily snapshots. Use for trend charts or when user asks about networth growth.',
  parameters: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      interval: { type: 'string', description: 'daily, weekly, or monthly', enum: ['daily', 'weekly', 'monthly'] },
    },
  },
  handler(args) {
    const db = getDb();
    const { start_date, end_date, interval = 'daily' } = args as Record<string, string>;

    let dateExpr = 'date';
    if (interval === 'weekly') dateExpr = "strftime('%Y-W%W', date)";
    else if (interval === 'monthly') dateExpr = "strftime('%Y-%m', date)";

    let where = '1=1';
    const params: unknown[] = [];
    if (start_date) { where += ' AND date >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND date <= ?'; params.push(end_date); }

    // If interval is not daily, take the last snapshot per interval period
    const sql = interval === 'daily'
      ? `SELECT date, networth, total_assets, total_liabilities FROM networth_snapshots WHERE ${where} ORDER BY date`
      : `SELECT ${dateExpr} as period, networth, total_assets, total_liabilities
         FROM networth_snapshots WHERE date IN (
           SELECT MAX(date) FROM networth_snapshots WHERE ${where} GROUP BY ${dateExpr}
         ) ORDER BY date`;

    const rows = db.prepare(sql).all(...(interval === 'daily' ? params : [...params, ...params])) as Record<string, unknown>[];
    return rows.map(r => ({
      date: r.date || r.period,
      networth: (r.networth as number) / 100,
      total_assets: (r.total_assets as number) / 100,
      total_liabilities: (r.total_liabilities as number) / 100,
    }));
  },
});

// ── compute_spending_trend ──────────────────────────────────────────

registerTool({
  name: 'compute_spending_trend',
  description: 'Calculate spending over time, optionally filtered by category. Use for trend analysis and month-over-month comparisons.',
  parameters: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      interval: { type: 'string', description: 'weekly or monthly', enum: ['weekly', 'monthly'] },
      category_slug: { type: 'string', description: 'Filter by category slug' },
    },
    required: ['start_date', 'end_date'],
  },
  handler(args) {
    const db = getDb();
    const { start_date, end_date, interval = 'monthly', category_slug } = args as Record<string, string>;

    const dateExpr = interval === 'weekly' ? "strftime('%Y-W%W', t.date)" : "strftime('%Y-%m', t.date)";
    let where = "t.direction = 'outflow' AND t.date >= ? AND t.date <= ?";
    const params: unknown[] = [start_date, end_date];

    let joins = '';
    if (category_slug) {
      joins = 'LEFT JOIN categories c ON t.category_id = c.id';
      where += ' AND (c.slug = ? OR c.slug LIKE ?)';
      params.push(category_slug, `${category_slug}.%`);
    }

    const rows = db.prepare(`
      SELECT ${dateExpr} as period, SUM(t.amount) as total, COUNT(*) as count
      FROM transactions t ${joins}
      WHERE ${where}
      GROUP BY ${dateExpr}
      ORDER BY period
    `).all(...params) as { period: string; total: number; count: number }[];

    return rows.map((r, i) => ({
      period: r.period,
      amount: r.total / 100,
      transaction_count: r.count,
      vs_previous_pct: i > 0 && rows[i - 1].total > 0
        ? Math.round(((r.total - rows[i - 1].total) / rows[i - 1].total) * 1000) / 10
        : null,
    }));
  },
});

// ── compute_category_deep_dive ──────────────────────────────────────

registerTool({
  name: 'compute_category_deep_dive',
  description: 'Deep analysis of a single spending category: merchant breakdown, frequency, day-of-week distribution, and trend. Use to understand a specific category in detail.',
  parameters: {
    type: 'object',
    properties: {
      category_slug: { type: 'string', description: 'Category slug e.g. food_and_drink' },
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
    },
    required: ['category_slug', 'start_date', 'end_date'],
  },
  handler(args) {
    const db = getDb();
    const { category_slug, start_date, end_date } = args as Record<string, string>;

    const baseWhere = "t.direction = 'outflow' AND t.date >= ? AND t.date <= ? AND (c.slug = ? OR c.slug LIKE ?)";
    const baseParams = [start_date, end_date, category_slug, `${category_slug}.%`];
    const joins = 'LEFT JOIN categories c ON t.category_id = c.id';

    // Total
    const total = db.prepare(`SELECT SUM(t.amount) as total, COUNT(*) as count FROM transactions t ${joins} WHERE ${baseWhere}`).get(...baseParams) as { total: number; count: number };

    // By merchant
    const byMerchant = db.prepare(`
      SELECT t.merchant_name, SUM(t.amount) as total, COUNT(*) as count, ROUND(AVG(t.amount)) as avg_amount
      FROM transactions t ${joins} WHERE ${baseWhere} AND t.merchant_name IS NOT NULL
      GROUP BY t.merchant_name ORDER BY SUM(t.amount) DESC LIMIT 10
    `).all(...baseParams) as { merchant_name: string; total: number; count: number; avg_amount: number }[];

    // By day of week (0=Sunday)
    const byDow = db.prepare(`
      SELECT CAST(strftime('%w', t.date) AS INTEGER) as dow, SUM(t.amount) as total
      FROM transactions t ${joins} WHERE ${baseWhere}
      GROUP BY dow ORDER BY dow
    `).all(...baseParams) as { dow: number; total: number }[];

    // Monthly trend
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', t.date) as month, SUM(t.amount) as total
      FROM transactions t ${joins} WHERE ${baseWhere}
      GROUP BY month ORDER BY month
    `).all(...baseParams) as { month: string; total: number }[];

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      total: (total.total || 0) / 100,
      transaction_count: total.count || 0,
      merchant_breakdown: byMerchant.map(r => ({ merchant: r.merchant_name, amount: r.total / 100, count: r.count, avg_per_txn: r.avg_amount / 100 })),
      day_of_week: byDow.map(r => ({ day: dayNames[r.dow], amount: r.total / 100 })),
      monthly_trend: monthly.map(r => ({ month: r.month, amount: r.total / 100 })),
    };
  },
});

// ── analyze_income_history ──────────────────────────────────────────

registerTool({
  name: 'analyze_income_history',
  description: 'Analyze historical income patterns: sources, growth over time, best months, stability. Use for "where have I made the most money?"',
  parameters: {
    type: 'object',
    properties: {
      start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
    },
    required: ['start_date', 'end_date'],
  },
  handler(args) {
    const db = getDb();
    const { start_date, end_date } = args as Record<string, string>;

    // By source
    const bySrc = db.prepare(`
      SELECT COALESCE(merchant_name, 'Unknown') as source, SUM(ABS(amount)) as total, COUNT(*) as count
      FROM transactions WHERE direction = 'inflow' AND date >= ? AND date <= ?
      GROUP BY source ORDER BY total DESC
    `).all(start_date, end_date) as { source: string; total: number; count: number }[];

    // Monthly
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', date) as month, SUM(ABS(amount)) as total
      FROM transactions WHERE direction = 'inflow' AND date >= ? AND date <= ?
      GROUP BY month ORDER BY month
    `).all(start_date, end_date) as { month: string; total: number }[];

    const grandTotal = bySrc.reduce((s, r) => s + r.total, 0);
    const monthlyAmounts = monthly.map(r => r.total);
    const avgMonthly = monthlyAmounts.length > 0 ? monthlyAmounts.reduce((a, b) => a + b, 0) / monthlyAmounts.length : 0;

    // Stability: coefficient of variation (lower = more stable)
    const variance = monthlyAmounts.length > 1
      ? monthlyAmounts.reduce((s, v) => s + (v - avgMonthly) ** 2, 0) / monthlyAmounts.length
      : 0;
    const cv = avgMonthly > 0 ? Math.sqrt(variance) / avgMonthly : 0;
    const stabilityScore = Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));

    return {
      total_earned: grandTotal / 100,
      by_source: bySrc.map(r => ({
        source: r.source,
        total: r.total / 100,
        percentage: grandTotal > 0 ? Math.round((r.total / grandTotal) * 1000) / 10 : 0,
        count: r.count,
      })),
      monthly: monthly.map(r => ({ month: r.month, income: r.total / 100 })),
      avg_monthly_income: avgMonthly / 100,
      income_stability_score: stabilityScore,
    };
  },
});

// ── compare_periods ─────────────────────────────────────────────────

registerTool({
  name: 'compare_periods',
  description: 'Compare two time periods side by side: spending, income, savings rate. Use for "how did this month compare to last month?"',
  parameters: {
    type: 'object',
    properties: {
      period_a_start: { type: 'string', description: 'Period A start (YYYY-MM-DD)' },
      period_a_end: { type: 'string', description: 'Period A end (YYYY-MM-DD)' },
      period_b_start: { type: 'string', description: 'Period B start (YYYY-MM-DD)' },
      period_b_end: { type: 'string', description: 'Period B end (YYYY-MM-DD)' },
      label_a: { type: 'string', description: 'Label for period A (e.g. "February")' },
      label_b: { type: 'string', description: 'Label for period B (e.g. "March")' },
    },
    required: ['period_a_start', 'period_a_end', 'period_b_start', 'period_b_end'],
  },
  handler(args) {
    const db = getDb();
    const a = args as Record<string, string>;

    function computePeriod(start: string, end: string) {
      const row = db.prepare(`
        SELECT SUM(CASE WHEN direction='outflow' THEN amount ELSE 0 END) as spending,
               SUM(CASE WHEN direction='inflow' THEN ABS(amount) ELSE 0 END) as income
        FROM transactions WHERE date >= ? AND date <= ? AND direction != 'transfer'
      `).get(start, end) as { spending: number; income: number };
      const spending = (row.spending || 0) / 100;
      const income = (row.income || 0) / 100;
      return { spending, income, savings: income - spending, savings_rate_pct: income > 0 ? Math.round(((income - spending) / income) * 1000) / 10 : 0 };
    }

    const periodA = computePeriod(a.period_a_start, a.period_a_end);
    const periodB = computePeriod(a.period_b_start, a.period_b_end);

    return {
      period_a: { label: a.label_a || `${a.period_a_start} to ${a.period_a_end}`, ...periodA },
      period_b: { label: a.label_b || `${a.period_b_start} to ${a.period_b_end}`, ...periodB },
      diff: {
        spending_delta: periodB.spending - periodA.spending,
        spending_delta_pct: periodA.spending > 0 ? Math.round(((periodB.spending - periodA.spending) / periodA.spending) * 1000) / 10 : null,
        income_delta: periodB.income - periodA.income,
        savings_rate_delta: periodB.savings_rate_pct - periodA.savings_rate_pct,
      },
    };
  },
});
