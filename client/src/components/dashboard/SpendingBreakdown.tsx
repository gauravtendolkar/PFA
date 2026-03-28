import { motion } from "framer-motion";

interface Category {
  name: string;
  amount: number;
  pct: number;
}

interface SpendingBreakdownProps {
  categories?: Category[];
}

const defaultCategories = [
  { name: "Housing", amount: 2400, pct: 38 },
  { name: "Food & Dining", amount: 890, pct: 14 },
  { name: "Transport", amount: 650, pct: 10 },
  { name: "Savings", amount: 1500, pct: 24 },
  { name: "Entertainment", amount: 420, pct: 7 },
  { name: "Other", amount: 440, pct: 7 },
];

const SpendingBreakdown = ({ categories = defaultCategories }: SpendingBreakdownProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="glass-surface rounded-lg p-4"
    >
      <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-4">
        Spending Breakdown
      </p>
      <div className="space-y-3">
        {categories.slice(0, 8).map((cat, i) => (
          <div key={cat.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-foreground">{cat.name}</span>
              <div className="flex gap-2">
                <span className="text-muted-foreground text-[11px] tabular-nums">${Math.round(cat.amount).toLocaleString()}</span>
                <span className="text-muted-foreground/50 text-[10px] tabular-nums w-8 text-right">{Math.round(cat.pct)}%</span>
              </div>
            </div>
            <div className="h-1 bg-secondary rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(cat.pct, 100)}%` }}
                transition={{ duration: 0.6, delay: 0.1 * i, ease: "easeOut" }}
                className="h-full rounded-full bg-foreground/20"
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default SpendingBreakdown;
