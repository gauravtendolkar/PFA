import { registerTool } from './registry.js';

// ── project_networth ────────────────────────────────────────────────

registerTool({
  name: 'project_networth',
  description: 'Project future networth using compound interest + monthly savings. Use for "what will my networth be in X years?" Runs three scenarios: conservative (5%), baseline (7%), optimistic (10%).',
  parameters: {
    type: 'object',
    properties: {
      current_networth: { type: 'number', description: 'Current networth in dollars' },
      monthly_savings: { type: 'number', description: 'Monthly savings in dollars' },
      months_ahead: { type: 'number', description: 'How many months to project' },
      annual_return_pct: { type: 'number', description: 'Annual investment return % (default: runs 3 scenarios)' },
      invested_fraction: { type: 'number', description: 'Fraction of networth that is invested (0-1, default 0.5)' },
    },
    required: ['current_networth', 'monthly_savings', 'months_ahead'],
  },
  handler(args) {
    const nw = args.current_networth as number;
    const monthlySavings = args.monthly_savings as number;
    const months = args.months_ahead as number;
    const investedFrac = (args.invested_fraction as number) ?? 0.5;

    const rates = args.annual_return_pct != null
      ? [{ name: 'custom', rate: args.annual_return_pct as number }]
      : [{ name: 'conservative', rate: 5 }, { name: 'baseline', rate: 7 }, { name: 'optimistic', rate: 10 }];

    const scenarios = rates.map(({ name, rate }) => {
      const monthlyRate = rate / 100 / 12;
      const projections: { month: number; networth: number }[] = [];

      let invested = nw * investedFrac;
      let cash = nw * (1 - investedFrac);

      for (let m = 1; m <= months; m++) {
        invested = invested * (1 + monthlyRate) + monthlySavings * investedFrac;
        cash += monthlySavings * (1 - investedFrac);
        if (m % 3 === 0 || m === months) { // sample quarterly + final
          projections.push({ month: m, networth: Math.round(invested + cash) });
        }
      }

      return {
        scenario: name,
        annual_return_pct: rate,
        final_networth: Math.round(invested + cash),
        projections,
      };
    });

    return { scenarios };
  },
});

// ── compute_goal_timeline ───────────────────────────────────────────

registerTool({
  name: 'compute_goal_timeline',
  description: 'Calculate when the user will reach a financial goal. Use for "when will I reach $X?" or "when will I be debt-free?"',
  parameters: {
    type: 'object',
    properties: {
      current_amount: { type: 'number', description: 'Current networth or savings in dollars' },
      target_amount: { type: 'number', description: 'Target amount in dollars' },
      monthly_contribution: { type: 'number', description: 'Monthly savings/contribution in dollars' },
      annual_return_pct: { type: 'number', description: 'Expected annual return % (default 7)' },
    },
    required: ['current_amount', 'target_amount', 'monthly_contribution'],
  },
  handler(args) {
    const current = args.current_amount as number;
    const target = args.target_amount as number;
    const monthly = args.monthly_contribution as number;
    const annualRate = (args.annual_return_pct as number) ?? 7;
    const monthlyRate = annualRate / 100 / 12;

    // With returns
    let balance = current;
    let monthsWithReturns = 0;
    while (balance < target && monthsWithReturns < 600) { // cap at 50 years
      balance = balance * (1 + monthlyRate) + monthly;
      monthsWithReturns++;
    }

    // Without returns
    const monthsWithout = monthly > 0 ? Math.ceil((target - current) / monthly) : Infinity;

    const now = new Date();
    const estDate = new Date(now);
    estDate.setMonth(estDate.getMonth() + monthsWithReturns);

    return {
      months_to_goal: monthsWithReturns >= 600 ? null : monthsWithReturns,
      estimated_date: monthsWithReturns >= 600 ? null : estDate.toISOString().split('T')[0],
      years: monthsWithReturns >= 600 ? null : Math.round(monthsWithReturns / 12 * 10) / 10,
      months_without_returns: monthsWithout > 600 ? null : monthsWithout,
      assumptions: {
        annual_return_pct: annualRate,
        monthly_contribution: monthly,
      },
    };
  },
});

// ── simulate_savings_plan ───────────────────────────────────────────

registerTool({
  name: 'simulate_savings_plan',
  description: 'Compare current savings trajectory vs a modified one. Use for "what if I cut dining by 30%?" or "what if I earn $500 more per month?"',
  parameters: {
    type: 'object',
    properties: {
      months: { type: 'number', description: 'Simulation period in months' },
      current_monthly_income: { type: 'number', description: 'Current monthly income in dollars' },
      current_monthly_spending: { type: 'number', description: 'Current monthly spending in dollars' },
      changes: {
        type: 'object',
        description: 'Proposed changes',
        properties: {
          spending_reduction: { type: 'number', description: 'Monthly spending reduction in dollars' },
          income_increase: { type: 'number', description: 'Monthly income increase in dollars' },
        },
      },
      annual_return_pct: { type: 'number', description: 'Annual return on invested savings (default 7)' },
    },
    required: ['months', 'current_monthly_income', 'current_monthly_spending'],
  },
  handler(args) {
    const months = args.months as number;
    const income = args.current_monthly_income as number;
    const spending = args.current_monthly_spending as number;
    const changes = (args.changes || {}) as Record<string, number>;
    const rate = ((args.annual_return_pct as number) ?? 7) / 100 / 12;

    const currentSavings = income - spending;
    const newSavings = currentSavings + (changes.spending_reduction || 0) + (changes.income_increase || 0);

    function simulate(monthlySavings: number) {
      let total = 0;
      const points: { month: number; cumulative: number }[] = [];
      for (let m = 1; m <= months; m++) {
        total = total * (1 + rate) + monthlySavings;
        if (m % 3 === 0 || m === months) {
          points.push({ month: m, cumulative: Math.round(total) });
        }
      }
      return { total: Math.round(total), points };
    }

    const current = simulate(currentSavings);
    const modified = simulate(newSavings);

    return {
      current_monthly_savings: currentSavings,
      modified_monthly_savings: newSavings,
      current_trajectory: current,
      modified_trajectory: modified,
      total_difference: modified.total - current.total,
      savings_rate_change: {
        from_pct: income > 0 ? Math.round((currentSavings / income) * 1000) / 10 : 0,
        to_pct: income > 0 ? Math.round((newSavings / income) * 1000) / 10 : 0,
      },
    };
  },
});
