import { useRef, useEffect } from "react";
import { Bot } from "lucide-react";
import UserMessage from "./UserMessage";
import AgentMessage from "./AgentMessage";
import StatusIndicator from "./StatusIndicator";
import ChatInput from "./ChatInput";
import type { ToolCallResult } from "@/lib/api";
import ReactMarkdown from "react-markdown";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp?: string;
  toolCalls?: ToolCallResult[];
  thinking?: string | null;
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText: string;
  streamingText: string;
  hasActivity: boolean;
  onSend: (message: string) => void;
  onOpenActivity: () => void;
}

const ChatArea = ({ messages, isProcessing, statusText, streamingText, hasActivity, onSend, onOpenActivity }: ChatAreaProps) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing, streamingText]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {messages.length === 0 && !isProcessing && (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center gap-5">
              <h2 className="font-display text-3xl md:text-4xl text-foreground">
                How can I help with your <em className="text-accent">finances</em>?
              </h2>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                Ask about spending, investments, budgets, or any financial question. I'll analyze your data and provide actionable insights.
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-1">
                {["What's my net worth?", "Spending breakdown", "How can I save more?"].map((q) => (
                  <button
                    key={q}
                    onClick={() => onSend(q)}
                    className="text-xs px-3.5 py-2 rounded-md border border-border bg-card hover:bg-secondary transition-colors text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) =>
            msg.role === "user" ? (
              <UserMessage key={msg.id} content={msg.content} timestamp={msg.timestamp} />
            ) : (
              <AgentMessage
                key={msg.id}
                content={msg.content}
                timestamp={msg.timestamp}
                hasActivity={hasActivity && idx === messages.length - 1}
                onShowActivity={onOpenActivity}
              />
            )
          )}

          {/* Status indicator: while thinking/tool calling (no text streaming yet) */}
          {isProcessing && !streamingText && (
            <StatusIndicator
              status={statusText}
              onClick={onOpenActivity}
              isVisible={true}
            />
          )}

          {/* Streaming final response text */}
          {streamingText && (
            <div className="flex justify-start mb-5 gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-md bg-secondary flex items-center justify-center mt-0.5">
                <Bot className="w-3.5 h-3.5 text-foreground" />
              </div>
              <div className="max-w-full min-w-0 flex-1 text-chat-agent-foreground">
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
                    }}
                  >
                    {streamingText}
                  </ReactMarkdown>
                  <span className="animate-pulse text-accent">▍</span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput onSend={onSend} disabled={isProcessing} />
    </div>
  );
};

export default ChatArea;
