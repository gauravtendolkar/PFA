import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Brain, Wrench, CheckCircle2, MessageSquare } from "lucide-react";
import type { ActivityItem } from "@/lib/api";

interface ActivityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  items: ActivityItem[];
  elapsed: number;
  isStreaming?: boolean;
}

const ActivityPanel = ({ isOpen, onClose, items, elapsed, isStreaming }: ActivityPanelProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 420, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="h-full border-l border-border bg-card flex flex-col overflow-hidden flex-shrink-0"
        >
          <div className="h-12 px-4 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Activity</span>
              <span className="text-xs text-muted-foreground">· {elapsed}s</span>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="p-4 space-y-1">
              {items.map((item, i) => (
                <ActivityRow key={i} item={item} showCursor={!!isStreaming && i === items.length - 1 && item.kind === 'thinking'} />
              ))}
              <div ref={bottomRef} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

function ActivityRow({ item, showCursor }: { item: ActivityItem; showCursor?: boolean }) {
  switch (item.kind) {
    case 'thinking':
      return (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2.5 py-2"
        >
          <div className="mt-0.5 shrink-0">
            <Brain className="w-4 h-4 text-muted-foreground/50" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap font-mono">
              {item.content}
              {showCursor && <span className="animate-pulse text-accent">▍</span>}
            </p>
          </div>
        </motion.div>
      );

    case 'tool_call':
      return (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 py-2"
        >
          <Wrench className="w-4 h-4 text-accent shrink-0" />
          <span className="text-xs font-medium text-foreground">{formatToolName(item.name)}</span>
        </motion.div>
      );

    case 'tool_result':
      return (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="ml-6 mb-1"
        >
          <div className="rounded-lg bg-muted/30 border border-border/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20">
              <CheckCircle2 className="w-3 h-3 text-chart-positive" />
              <span className="text-[10px] font-mono text-muted-foreground">{item.name}</span>
            </div>
            <pre className="text-[10px] text-muted-foreground/60 p-3 max-h-32 overflow-y-auto scrollbar-thin whitespace-pre-wrap break-all font-mono">
              {typeof item.result === 'string' ? item.result : JSON.stringify(item.result, null, 2)}
            </pre>
          </div>
        </motion.div>
      );

    case 'text':
      return (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2.5 py-2"
        >
          <MessageSquare className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{item.content}</p>
        </motion.div>
      );
  }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default ActivityPanel;
