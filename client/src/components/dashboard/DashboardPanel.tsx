import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Wallet, PiggyBank, CreditCard, TrendingUp, BarChart3 } from "lucide-react";
import StatCard from "./StatCard";
import NetWorthChart from "./NetWorthChart";
import SpendingBreakdown from "./SpendingBreakdown";
import type { ToolCallResult } from "@/lib/api";

interface DashboardPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  toolResults?: ToolCallResult[];
}

const fmt = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const DashboardPanel = ({ isOpen, onToggle, toolResults = [] }: DashboardPanelProps) => {
  const networth = toolResults.find(t => t.name === 'compute_networth')?.result as any;
  const spending = toolResults.find(t => t.name === 'compute_spending_summary')?.result as any;
  const accounts = toolResults.find(t => t.name === 'get_accounts')?.result as any[];
  const investments = toolResults.find(t => t.name === 'get_investments')?.result as any[];
  const savingsRate = toolResults.find(t => t.name === 'compute_savings_rate')?.result as any;
  const income = toolResults.find(t => t.name === 'compute_income_summary')?.result as any;

  const hasData = toolResults.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="h-full border-l border-border bg-surface-sunken flex flex-col overflow-hidden flex-shrink-0"
        >
          <div className="p-3 flex items-center justify-between border-b border-border bg-card">
            <h2 className="text-sm font-semibold text-foreground">Dashboard</h2>
            <button onClick={onToggle} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
            {!hasData && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-20">
                <BarChart3 className="w-8 h-8 text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground/50">Ask a question to see your data here</p>
              </div>
            )}

            {/* Stat cards from networth */}
            {networth && (
              <div className="grid grid-cols-2 gap-3">
                <StatCard title="Net Worth" value={fmt(networth.networth)} icon={Wallet} variant={networth.networth >= 0 ? undefined : 'negative'} />
                <StatCard title="Assets" value={fmt(networth.total_assets)} icon={TrendingUp} />
                <StatCard title="Liabilities" value={fmt(networth.total_liabilities)} icon={CreditCard} variant="negative" />
                {savingsRate ? (
                  <StatCard title="Savings Rate" value={`${savingsRate.average_savings_rate_pct}%`} icon={PiggyBank} change={savingsRate.average_savings_rate_pct >= 10 ? savingsRate.average_savings_rate_pct : undefined} />
                ) : spending ? (
                  <StatCard title="Spending" value={fmt(spending.total)} icon={CreditCard} variant="negative" />
                ) : null}
              </div>
            )}

            {/* Spending breakdown with real data */}
            {spending && spending.groups && (
              <SpendingBreakdown categories={spending.groups.map((g: any) => ({ name: g.name, amount: g.amount, pct: g.percentage }))} />
            )}

            {/* Accounts list */}
            {accounts && accounts.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-surface rounded-lg p-4">
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3">Accounts</p>
                <div className="space-y-2">
                  {accounts.map((a: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.classification === 'asset' ? 'bg-chart-positive' : 'bg-chart-negative'}`} />
                        <span className="truncate text-foreground">{a.name}</span>
                      </div>
                      <span className={`tabular-nums font-medium shrink-0 ml-2 ${a.classification === 'asset' ? 'text-chart-positive' : 'text-chart-negative'}`}>
                        {fmt(a.current_balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Investments */}
            {investments && investments.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-surface rounded-lg p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Holdings</p>
                  <span className="text-sm font-display tabular-nums">{fmt(investments.reduce((s: number, h: any) => s + h.value, 0))}</span>
                </div>
                <div className="space-y-1.5">
                  {investments.slice(0, 8).map((h: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{h.ticker || h.security_name}</span>
                      <span className="tabular-nums text-muted-foreground">{fmt(h.value)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Income */}
            {income && income.sources && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-surface rounded-lg p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Income</p>
                  <span className="text-sm font-display tabular-nums text-chart-positive">{fmt(income.total)}</span>
                </div>
                <div className="space-y-1.5">
                  {income.sources.map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground truncate">{s.name}</span>
                      <span className="tabular-nums">{fmt(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DashboardPanel;
