import { motion } from "framer-motion";
import { Bot, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface AgentMessageProps {
  content: string;
  timestamp?: string;
  hasActivity?: boolean;
  onShowActivity?: () => void;
}

const AgentMessage = ({ content, timestamp, hasActivity, onShowActivity }: AgentMessageProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex justify-start mb-5 gap-3"
    >
      <div className="flex-shrink-0 w-6 h-6 rounded-md bg-secondary flex items-center justify-center mt-0.5">
        <Bot className="w-3.5 h-3.5 text-foreground" />
      </div>
      <div className="max-w-full min-w-0 flex-1">
        {/* "Show thinking" button */}
        {hasActivity && onShowActivity && (
          <button
            onClick={onShowActivity}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mb-1.5 group"
          >
            <Sparkles className="w-3 h-3 text-accent/40 group-hover:text-accent" />
            <span>Show thinking</span>
          </button>
        )}
        <div className="text-chat-agent-foreground">
          <div className="text-[13px] leading-relaxed break-words">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="text-accent">{children}</em>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                li: ({ children }) => <li className="text-[13px]">{children}</li>,
                h1: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>,
                h2: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>,
                h3: ({ children }) => <h4 className="text-[13px] font-semibold mt-2 mb-1">{children}</h4>,
                code: ({ children, className }) => {
                  if (className?.includes("language-")) {
                    return <pre className="bg-muted rounded-lg p-3 my-2 text-[11px] overflow-x-auto"><code>{children}</code></pre>;
                  }
                  return <code className="bg-muted rounded px-1 py-0.5 text-[12px] font-mono">{children}</code>;
                },
                table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-[12px] w-full">{children}</table></div>,
                th: ({ children }) => <th className="text-left py-1 px-2 border-b border-border font-medium text-[11px]">{children}</th>,
                td: ({ children }) => <td className="py-1 px-2 border-b border-border/50 tabular-nums">{children}</td>,
                hr: () => <hr className="my-3 border-border/30" />,
              }}
            >
              {content}
            </ReactMarkdown>
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
