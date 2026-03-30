import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import Markdown from "markdown-to-jsx";
import { markdownOverrides } from "@/lib/markdown";
import type { ActivityItem } from "@/lib/api";

interface AgentMessageProps {
  content: string;
  timestamp?: string;
  activity?: ActivityItem[];
  onShowActivity?: () => void;
}

const AgentMessage = ({ content, timestamp, activity, onShowActivity }: AgentMessageProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex justify-start mb-5"
    >
      <div className="max-w-full min-w-0 flex-1">
        {activity && activity.length > 0 && onShowActivity && (
          <button
            onClick={onShowActivity}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mb-1.5 group"
          >
            <Sparkles className="w-3 h-3 text-accent/40 group-hover:text-accent" />
            <span>Show activity</span>
          </button>
        )}
        <div className="text-chat-agent-foreground">
          <div className="text-[13px] leading-relaxed break-words">
            <Markdown options={{ overrides: markdownOverrides }}>
              {content}
            </Markdown>
          </div>
        </div>
        {timestamp && (
          <p className="text-[10px] text-muted-foreground mt-1.5">{timestamp}</p>
        )}
      </div>
    </motion.div>
  );
};

export default AgentMessage;
