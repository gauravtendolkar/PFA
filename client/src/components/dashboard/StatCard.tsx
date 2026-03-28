import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  icon?: LucideIcon;
  variant?: "default" | "positive" | "negative";
}

const StatCard = ({ title, value, change, icon: Icon }: StatCardProps) => {
  const isPositive = (change ?? 0) > 0;
  const isNegative = (change ?? 0) < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-surface rounded-lg p-3.5"
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{title}</p>
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>
      <p className="text-lg font-display text-foreground">{value}</p>
      {change !== undefined && (
        <div className="flex items-center gap-1 mt-1.5">
          {isPositive ? (
            <TrendingUp className="w-3 h-3 text-chart-positive" />
          ) : isNegative ? (
            <TrendingDown className="w-3 h-3 text-chart-negative" />
          ) : (
            <Minus className="w-3 h-3 text-chart-neutral" />
          )}
          <span
            className={`text-[11px] tabular-nums ${
              isPositive ? "text-chart-positive" : isNegative ? "text-chart-negative" : "text-chart-neutral"
            }`}
          >
            {isPositive ? "+" : ""}{change}%
          </span>
        </div>
      )}
    </motion.div>
  );
};

export default StatCard;
