import { motion } from "framer-motion";
import { Bot, ChevronRight } from "lucide-react";

interface StatusIndicatorProps {
  status: string;
  onClick: () => void;
  isVisible: boolean;
}

const StatusIndicator = ({ status, onClick, isVisible }: StatusIndicatorProps) => {
  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      className="flex justify-start mb-5 gap-3"
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-md bg-secondary flex items-center justify-center mt-0.5">
        <Bot className="w-3.5 h-3.5 text-foreground" />
      </div>
      <button
        onClick={onClick}
        className="group flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
      >
        <span className="gradient-text text-sm font-medium">{status}</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </button>
    </motion.div>
  );
};

export default StatusIndicator;
