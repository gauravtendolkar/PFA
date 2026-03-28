import { useState, useCallback, useEffect, useRef } from "react";
import { LayoutDashboard, Menu } from "lucide-react";
import ChatHistory from "../sidebar/ChatHistory";
import ChatArea from "../chat/ChatArea";
import DashboardPanel from "../dashboard/DashboardPanel";
import ActivityPanel from "../activity/ActivityPanel";
import logoImg from "@/assets/logo.png";
import type { ChatMessage } from "../chat/ChatArea";
import { sendMessageStream, getSessions, loadSessionMessages, type ToolCallResult, type ActivityItem, type Session } from "@/lib/api";

const AppLayout = () => {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<'none' | 'dashboard' | 'activity'>('none');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [streamingText, setStreamingText] = useState(""); // final response streaming
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<{ id: string; title: string; preview: string; date: string; active?: boolean }[]>([]);
  const [toolResults, setToolResults] = useState<ToolCallResult[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [lastActivity, setLastActivity] = useState<{ items: ActivityItem[]; elapsed: number }>({ items: [], elapsed: 0 });
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    getSessions().then(raw => {
      setSessions(raw
        .filter((s: Session) => s.source === 'user_chat' && s.message_count > 0)
        .map((s: Session) => ({
          id: s.id,
          title: s.title || 'New chat',
          preview: `${s.message_count} messages`,
          date: formatRelativeDate(s.created_at),
          active: s.id === sessionId,
        })));
    }).catch(() => {});
  }, [sessionId]);

  const handleSend = useCallback(async (content: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: "user" as const,
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);

    setIsProcessing(true);
    setStatusText("Thinking...");
    setStreamingText("");
    setActivityItems([]);
    setElapsed(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    try {
      await sendMessageStream(content, {
        onActivity(item) {
          setActivityItems(prev => [...prev, item]);
        },
        onStatusChange(status) {
          setStatusText(status);
        },
        onStreamText(fullText) {
          // This is final response text streaming into chat
          setStreamingText(fullText);
        },
        onDone(event) {
          setSessionId(event.session_id);

          for (const tc of event.tool_calls_made) {
            setToolResults(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(t => t.name === tc.name);
              if (idx >= 0) updated[idx] = tc; else updated.push(tc);
              return updated;
            });
          }
          if (event.tool_calls_made.length > 0 && rightPanel !== 'activity') {
            setRightPanel('dashboard');
          }

          // Persist activity for this turn
          setActivityItems(current => {
            setLastActivity({
              items: current,
              elapsed: Math.floor((Date.now() - startTimeRef.current) / 1000),
            });
            return current;
          });

          // Final response → chat message
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: "agent" as const,
            content: event.message,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }]);
          cleanup();
        },
        onError(msg) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: "agent" as const,
            content: `Error: ${msg}`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }]);
          cleanup();
        },
      }, sessionId ?? undefined);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "agent" as const,
        content: `Connection error: ${err instanceof Error ? err.message : 'Unknown'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
      cleanup();
    }

    function cleanup() {
      setIsProcessing(false);
      setStreamingText("");
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [sessionId, rightPanel]);

  const handleNewSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setToolResults([]);
    setActivityItems([]);
    setLastActivity({ items: [], elapsed: 0 });
  }, []);

  const handleSelectSession = useCallback(async (id: string, dismissSidebar = false) => {
    setSessionId(id);
    setToolResults([]);
    setActivityItems([]);
    setLastActivity({ items: [], elapsed: 0 });
    if (dismissSidebar) setLeftOpen(false);

    try {
      const pastMessages = await loadSessionMessages(id);
      setMessages(pastMessages.map((m, i) => ({
        id: `${id}-${i}`,
        role: m.role,
        content: m.content,
      })));
    } catch {
      setMessages([]);
    }
  }, []);

  const toggleRightPanel = useCallback((panel: 'dashboard' | 'activity') => {
    setRightPanel(prev => prev === panel ? 'none' : panel);
  }, []);

  const displayActivity = isProcessing ? { items: activityItems, elapsed } : lastActivity;
  const hasActivity = displayActivity.items.length > 0;

  return (
    <div className="h-dvh flex flex-col bg-background">
      <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setLeftOpen(!leftOpen)} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <img src={logoImg} alt="PFA" className="w-6 h-6 rounded-full" width={24} height={24} />
            <span className="font-display text-xl text-foreground leading-none">PFA</span>
          </div>
        </div>
        <button onClick={() => toggleRightPanel('dashboard')} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <LayoutDashboard className="w-4 h-4" />
        </button>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="hidden md:flex">
          <ChatHistory sessions={sessions} onSelect={(id) => handleSelectSession(id)} onNew={handleNewSession} isOpen={leftOpen} onToggle={() => setLeftOpen(false)} />
        </div>
        {leftOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={() => setLeftOpen(false)} />
            <div className="relative z-10">
              <ChatHistory sessions={sessions} onSelect={(id) => handleSelectSession(id, true)} onNew={handleNewSession} isOpen={true} onToggle={() => setLeftOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <ChatArea
            messages={messages}
            isProcessing={isProcessing}
            statusText={statusText}
            streamingText={streamingText}
            hasActivity={hasActivity}
            onSend={handleSend}
            onOpenActivity={() => toggleRightPanel('activity')}
          />
        </div>

        <div className="hidden md:flex">
          {rightPanel === 'dashboard' && (
            <DashboardPanel isOpen={true} onToggle={() => setRightPanel('none')} toolResults={toolResults} />
          )}
          {rightPanel === 'activity' && (
            <ActivityPanel isOpen={true} onClose={() => setRightPanel('none')} items={displayActivity.items} elapsed={displayActivity.elapsed} />
          )}
        </div>
      </div>
    </div>
  );
};

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function formatRelativeDate(iso: string): string {
  const now = new Date();
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default AppLayout;
