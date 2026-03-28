import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const data = [
  { month: "Jul", value: 124000 },
  { month: "Aug", value: 128500 },
  { month: "Sep", value: 125200 },
  { month: "Oct", value: 132800 },
  { month: "Nov", value: 138400 },
  { month: "Dec", value: 135100 },
  { month: "Jan", value: 142300 },
  { month: "Feb", value: 148900 },
  { month: "Mar", value: 156200 },
];

const formatValue = (v: number) => `$${(v / 1000).toFixed(0)}k`;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-3 py-2 text-xs shadow-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground tabular-nums">${payload[0].value.toLocaleString()}</p>
    </div>
  );
};

const NetWorthChart = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass-surface rounded-lg p-4"
    >
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Net Worth</p>
          <p className="text-2xl font-display text-foreground mt-1">$156,200</p>
        </div>
        <div className="flex gap-0.5">
          {["1M", "3M", "1Y", "All"].map((period) => (
            <button
              key={period}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                period === "1Y"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="netWorthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(320, 45%, 42%)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(320, 45%, 42%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: '"DM Sans"' }} stroke="hsl(30, 5%, 46%)" tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fontFamily: '"DM Sans"' }} stroke="hsl(30, 5%, 46%)" tickLine={false} axisLine={false} tickFormatter={formatValue} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(320, 45%, 42%)"
              strokeWidth={1.5}
              fill="url(#netWorthGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default NetWorthChart;
