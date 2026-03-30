import { motion, AnimatePresence } from "framer-motion";
import { Brain } from "lucide-react";

interface ThinkingIndicatorProps {
  status?: string;
  isVisible?: boolean;
}

const ThinkingIndicator = ({ status = "Analyzing your finances...", isVisible = true }: ThinkingIndicatorProps) => {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5, transition: { duration: 0.2 } }}
          className="flex justify-start mb-4 gap-2.5"
        >
          <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center mt-1">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Brain className="w-4 h-4 text-primary" />
            </motion.div>
          </div>
          <div className="bg-chat-agent rounded-2xl rounded-bl-md px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-typing-dot-1" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-typing-dot-2" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-typing-dot-3" />
              </div>
              <motion.span
                key={status}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-muted-foreground"
              >
                {status}
              </motion.span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ThinkingIndicator;
