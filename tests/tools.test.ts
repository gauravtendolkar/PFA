import { describe, it, expect, beforeAll } from 'vitest';
import { migrate, getDb, closeDb } from '../src/db/index.js';
import { getToolDefinitions, getToolNames, getToolCount, executeTool } from '../src/tools/index.js';

// Use the project-local test DB (set by PFA_DATA_DIR in .env)
beforeAll(() => {
  migrate();
});

// ── Registry ────────────────────────────────────────────────────────

describe('Tool Registry', () => {
  it('should have all tools registered', () => {
    const count = getToolCount();
    expect(count).toBeGreaterThanOrEqual(20);
    console.log(`Registered ${count} tools:`, getToolNames().join(', '));
  });

  it('should return valid tool definitions for LLM', () => {
    const defs = getToolDefinitions();
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.parameters.type).toBe('object');
      // No handler leaked into definitions
      expect((def as any).handler).toBeUndefined();
    }
  });

  it('should throw on unknown tool', async () => {
    await expect(executeTool('nonexistent_tool', {})).rejects.toThrow('Unknown tool');
  });
});

// ── Bank Data Tools ─────────────────────────────────────────────────

describe('Bank Data Tools', () => {
  it('get_accounts returns accounts with balances', async () => {
    const result = await executeTool('get_accounts', {}) as any[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const acct = result[0];
    expect(acct).toHaveProperty('id');
    expect(acct).toHaveProperty('name');
    expect(acct).toHaveProperty('type');
    expect(acct).toHaveProperty('classification');
    expect(typeof acct.current_balance).toBe('number');
    // Balances should be in dollars (not cents)
    expect(Math.abs(acct.current_balance)).toBeGreaterThan(0.5);
  });

  it('get_accounts filters by classification', async () => {
    const assets = await executeTool('get_accounts', { classification: 'asset' }) as any[];
    const liabilities = await executeTool('get_accounts', { classification: 'liability' }) as any[];
    expect(assets.every((a: any) => a.classification === 'asset')).toBe(true);
    expect(liabilities.every((a: any) => a.classification === 'liability')).toBe(true);
  });

  it('get_transactions returns transactions', async () => {
    const result = await executeTool('get_transactions', { limit: 5 }) as any[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
    if (result.length > 0) {
      const txn = result[0];
      expect(txn).toHaveProperty('amount');
      expect(txn).toHaveProperty('date');
      expect(txn).toHaveProperty('name');
      expect(txn).toHaveProperty('direction');
      // Amount in dollars
      expect(typeof txn.amount).toBe('number');
    }
  });

  it('get_transactions filters by direction', async () => {
    const outflows = await executeTool('get_transactions', { direction: 'outflow', limit: 10 }) as any[];
    expect(outflows.every((t: any) => t.direction === 'outflow')).toBe(true);
  });

  it('get_transactions filters by date range', async () => {
    const all = await executeTool('get_transactions', { limit: 200 }) as any[];
    if (all.length > 0) {
      const midDate = all[Math.floor(all.length / 2)].date;
      const filtered = await executeTool('get_transactions', { start_date: midDate, limit: 200 }) as any[];
      expect(filtered.every((t: any) => t.date >= midDate)).toBe(true);
    }
  });

  it('get_transactions filters by merchant', async () => {
    const result = await executeTool('get_transactions', { merchant: 'Uber', limit: 50 }) as any[];
    expect(result.every((t: any) => t.merchant_name?.toLowerCase().includes('uber'))).toBe(true);
  });

  it('get_balances returns balances in dollars', async () => {
    const result = await executeTool('get_balances', {}) as any[];
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('current_balance');
    expect(typeof result[0].current_balance).toBe('number');
  });

  it('get_investments returns holdings', async () => {
    const result = await executeTool('get_investments', {}) as any[];
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('ticker');
      expect(result[0]).toHaveProperty('quantity');
      expect(result[0]).toHaveProperty('value');
      expect(typeof result[0].value).toBe('number');
    }
  });

  it('get_recurring_transactions detects patterns', async () => {
    const result = await executeTool('get_recurring_transactions', { min_occurrences: 2 }) as any[];
    expect(Array.isArray(result)).toBe(true);
    for (const r of result) {
      expect(r).toHaveProperty('merchant_name');
      expect(r).toHaveProperty('frequency');
      expect(r).toHaveProperty('avg_amount');
      expect(['weekly', 'biweekly', 'monthly', 'quarterly']).toContain(r.frequency);
    }
  });
});

// ── Analysis Tools ──────────────────────────────────────────────────

describe('Analysis Tools', () => {
  // Get date range from actual data
  let startDate: string;
  let endDate: string;

  beforeAll(async () => {
    const txns = await executeTool('get_transactions', { limit: 200 }) as any[];
    if (txns.length > 0) {
      const dates = txns.map((t: any) => t.date).sort();
      startDate = dates[0];
      endDate = dates[dates.length - 1];
    } else {
      startDate = '2025-01-01';
      endDate = '2026-12-31';
    }
  });

  it('compute_spending_summary groups by category', async () => {
    const result = await executeTool('compute_spending_summary', { start_date: startDate, end_date: endDate }) as any;
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('groups');
    expect(result.total).toBeGreaterThan(0);
    expect(result.groups.length).toBeGreaterThan(0);

    // Percentages should roughly sum to 100
    const pctSum = result.groups.reduce((s: number, g: any) => s + g.percentage, 0);
    expect(pctSum).toBeGreaterThan(95);
    expect(pctSum).toBeLessThanOrEqual(100.1);
  });

  it('compute_spending_summary groups by merchant', async () => {
    const result = await executeTool('compute_spending_summary', { start_date: startDate, end_date: endDate, group_by: 'merchant' }) as any;
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups[0]).toHaveProperty('name');
  });

  it('compute_spending_summary groups by month', async () => {
    const result = await executeTool('compute_spending_summary', { start_date: startDate, end_date: endDate, group_by: 'month' }) as any;
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups[0].name).toMatch(/^\d{4}-\d{2}$/);
  });

  it('compute_income_summary returns income breakdown', async () => {
    const result = await executeTool('compute_income_summary', { start_date: startDate, end_date: endDate }) as any;
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('sources');
  });

  it('compute_savings_rate returns rate', async () => {
    const result = await executeTool('compute_savings_rate', { start_date: startDate, end_date: endDate }) as any;
    expect(result).toHaveProperty('average_savings_rate_pct');
    expect(typeof result.average_savings_rate_pct).toBe('number');
  });

  it('compute_savings_rate with monthly interval', async () => {
    const result = await executeTool('compute_savings_rate', { start_date: startDate, end_date: endDate, interval: 'monthly' }) as any;
    expect(result.periods.length).toBeGreaterThan(0);
    expect(result.periods[0]).toHaveProperty('income');
    expect(result.periods[0]).toHaveProperty('spending');
    expect(result.periods[0]).toHaveProperty('savings_rate_pct');
  });

  it('compute_networth returns breakdown', async () => {
    const result = await executeTool('compute_networth', {}) as any;
    expect(result).toHaveProperty('networth');
    expect(result).toHaveProperty('total_assets');
    expect(result).toHaveProperty('total_liabilities');
    expect(result).toHaveProperty('breakdown');
    expect(result.networth).toBe(result.total_assets - result.total_liabilities);
  });

  it('compute_networth_trend returns data points', async () => {
    const result = await executeTool('compute_networth_trend', {}) as any[];
    expect(Array.isArray(result)).toBe(true);
    // We should have at least 1 snapshot from the sync
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('networth');
    }
  });

  it('compute_spending_trend returns periods with amounts', async () => {
    const result = await executeTool('compute_spending_trend', { start_date: startDate, end_date: endDate, interval: 'monthly' }) as any[];
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('period');
      expect(result[0]).toHaveProperty('amount');
    }
  });

  it('compute_category_deep_dive returns detailed breakdown', async () => {
    const result = await executeTool('compute_category_deep_dive', {
      category_slug: 'food_and_drink',
      start_date: startDate,
      end_date: endDate,
    }) as any;
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('merchant_breakdown');
    expect(result).toHaveProperty('day_of_week');
    expect(result).toHaveProperty('monthly_trend');
  });

  it('analyze_income_history returns analysis', async () => {
    const result = await executeTool('analyze_income_history', { start_date: startDate, end_date: endDate }) as any;
    expect(result).toHaveProperty('total_earned');
    expect(result).toHaveProperty('by_source');
    expect(result).toHaveProperty('income_stability_score');
    expect(result.income_stability_score).toBeGreaterThanOrEqual(0);
    expect(result.income_stability_score).toBeLessThanOrEqual(100);
  });

  it('compare_periods returns diff', async () => {
    const result = await executeTool('compare_periods', {
      period_a_start: startDate, period_a_end: endDate,
      period_b_start: startDate, period_b_end: endDate,
      label_a: 'Same', label_b: 'Same',
    }) as any;
    expect(result).toHaveProperty('period_a');
    expect(result).toHaveProperty('period_b');
    expect(result).toHaveProperty('diff');
    // Same period compared to itself should have 0 delta
    expect(result.diff.spending_delta).toBe(0);
  });
});

// ── Modeling Tools ──────────────────────────────────────────────────

describe('Modeling Tools', () => {
  it('project_networth runs scenarios', async () => {
    const result = await executeTool('project_networth', {
      current_networth: 100000,
      monthly_savings: 2000,
      months_ahead: 60,
    }) as any;
    expect(result).toHaveProperty('scenarios');
    expect(result.scenarios.length).toBe(3); // conservative, baseline, optimistic
    for (const s of result.scenarios) {
      expect(s.final_networth).toBeGreaterThan(100000);
      expect(s.projections.length).toBeGreaterThan(0);
    }
    // Optimistic should be highest
    expect(result.scenarios[2].final_networth).toBeGreaterThan(result.scenarios[0].final_networth);
  });

  it('compute_goal_timeline calculates months to target', async () => {
    const result = await executeTool('compute_goal_timeline', {
      current_amount: 100000,
      target_amount: 500000,
      monthly_contribution: 3000,
    }) as any;
    expect(result).toHaveProperty('months_to_goal');
    expect(result).toHaveProperty('estimated_date');
    expect(result.months_to_goal).toBeGreaterThan(0);
    expect(result.months_to_goal).toBeLessThan(600);
  });

  it('simulate_savings_plan compares trajectories', async () => {
    const result = await executeTool('simulate_savings_plan', {
      months: 12,
      current_monthly_income: 7000,
      current_monthly_spending: 5000,
      changes: { spending_reduction: 500, income_increase: 1000 },
    }) as any;
    expect(result.current_monthly_savings).toBe(2000);
    expect(result.modified_monthly_savings).toBe(3500);
    expect(result.modified_trajectory.total).toBeGreaterThan(result.current_trajectory.total);
    expect(result.total_difference).toBeGreaterThan(0);
  });
});

// ── Write Ops ───────────────────────────────────────────────────────

describe('Write Ops', () => {
  it('upsert_insight creates and delete_insight removes', async () => {
    const created = await executeTool('upsert_insight', {
      type: 'tip',
      title: 'Test insight',
      body: 'This is a test',
      priority: 'low',
    }) as any;
    expect(created).toHaveProperty('insight_id');

    const deleted = await executeTool('delete_insight', { insight_id: created.insight_id }) as any;
    expect(deleted.success).toBe(true);
  });

  it('crud_manual_asset create → read → update → delete', async () => {
    // Create
    const created = await executeTool('crud_manual_asset', {
      action: 'create', name: 'Test House', type: 'property', value: 500000,
    }) as any;
    expect(created).toHaveProperty('account_id');

    // Read
    const read = await executeTool('crud_manual_asset', {
      action: 'read', account_id: created.account_id,
    }) as any[];
    expect(read.length).toBe(1);
    expect(read[0].name).toBe('Test House');
    expect(read[0].current_balance).toBe(500000);

    // Update
    const updated = await executeTool('crud_manual_asset', {
      action: 'update', account_id: created.account_id, value: 520000,
    }) as any;
    expect(updated.success).toBe(true);

    // Verify update
    const readAgain = await executeTool('crud_manual_asset', {
      action: 'read', account_id: created.account_id,
    }) as any[];
    expect(readAgain[0].current_balance).toBe(520000);

    // Delete (soft)
    const deleted = await executeTool('crud_manual_asset', {
      action: 'delete', account_id: created.account_id,
    }) as any;
    expect(deleted.success).toBe(true);

    // Verify deleted (not returned in active accounts)
    const readDeleted = await executeTool('crud_manual_asset', {
      action: 'read', account_id: created.account_id,
    }) as any[];
    expect(readDeleted.length).toBe(0);
  });

  it('update_transaction_category changes category', async () => {
    const txns = await executeTool('get_transactions', { limit: 1 }) as any[];
    if (txns.length === 0) return;

    const result = await executeTool('update_transaction_category', {
      transaction_id: txns[0].id,
      category_slug: 'shopping.electronics',
    }) as any;
    expect(result.success).toBe(true);
  });

  it('add_transaction_note adds a note', async () => {
    const txns = await executeTool('get_transactions', { limit: 1 }) as any[];
    if (txns.length === 0) return;

    const result = await executeTool('add_transaction_note', {
      transaction_id: txns[0].id,
      note: 'Test note from vitest',
    }) as any;
    expect(result.success).toBe(true);
  });

  it('get_dashboard_data returns full dashboard payload', async () => {
    const result = await executeTool('get_dashboard_data', {}) as any;
    expect(result).toHaveProperty('networth');
    expect(result).toHaveProperty('accounts');
    expect(result).toHaveProperty('recent_transactions');
    expect(result).toHaveProperty('insights');
    expect(result).toHaveProperty('networth_trend');
  });
});
