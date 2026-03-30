import { useRef, useEffect } from "react";
import UserMessage from "./UserMessage";
import AgentMessage from "./AgentMessage";
import StatusIndicator from "./StatusIndicator";
import ChatInput from "./ChatInput";
import type { ActivityItem } from "@/lib/api";
import Markdown from "markdown-to-jsx";
import { markdownOverrides } from "@/lib/markdown";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp?: string;
  activity?: ActivityItem[];
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText: string;
  streamingText: string;
  hasActivity: boolean;
  onSend: (message: string) => void;
  onShowActivity: (activity?: ActivityItem[]) => void;
}

const ChatArea = ({ messages, isProcessing, statusText, streamingText, hasActivity, onSend, onShowActivity }: ChatAreaProps) => {
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
                activity={msg.activity}
                onShowActivity={() => onShowActivity(msg.activity)}
              />
            )
          )}

          {/* Status indicator: while thinking/tool calling (no text streaming yet) */}
          {isProcessing && !streamingText && (
            <StatusIndicator
              status={statusText}
              onClick={() => onShowActivity()}
              isVisible={true}
            />
          )}

          {/* Streaming final response text with streaming-safe markdown */}
          {streamingText && (
            <div className="flex justify-start mb-5">
              <div className="max-w-full min-w-0 flex-1 text-chat-agent-foreground">
                <div className="text-[13px] leading-relaxed break-words">
                  <Markdown options={{ optimizeForStreaming: true, overrides: markdownOverrides }}>
                    {streamingText}
                  </Markdown>
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
