import { useState, useCallback, useEffect, useRef } from "react";
import { LayoutDashboard, Menu, Plus, Settings } from "lucide-react";
import ChatHistory from "../sidebar/ChatHistory";
import ChatArea from "../chat/ChatArea";
import DashboardPanel from "../dashboard/DashboardPanel";
import ActivityPanel from "../activity/ActivityPanel";
import ConnectAccountDialog from "../connect/ConnectAccountDialog";
import SettingsDialog from "../settings/SettingsDialog";
import logoImg from "@/assets/logo.png";
import type { ChatMessage } from "../chat/ChatArea";
import { sendMessageStream, getSessions, loadSessionMessages, type ToolCallResult, type ActivityItem, type Session } from "@/lib/api";

/** Per-session state that persists across session switches */
interface SessionState {
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText: string;
  streamingText: string;
  activityItems: ActivityItem[];
  lastActivity: { items: ActivityItem[]; elapsed: number };
  elapsed: number;
  toolResults: ToolCallResult[];
  abortController: AbortController | null;
  timerInterval: ReturnType<typeof setInterval> | null;
  startTime: number;
}

function emptySessionState(): SessionState {
  return {
    messages: [], isProcessing: false, statusText: "", streamingText: "",
    activityItems: [], lastActivity: { items: [], elapsed: 0 }, elapsed: 0,
    toolResults: [], abortController: null, timerInterval: null, startTime: 0,
  };
}

const AppLayout = () => {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<'none' | 'dashboard' | 'activity'>('none');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<{ id: string; title: string; preview: string; date: string; active?: boolean }[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Per-session state lives in a ref map; we copy the current session's state
  // into React state for rendering via a render trigger.
  const statesRef = useRef<Map<string | null, SessionState>>(new Map());
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);

  function getState(sid: string | null): SessionState {
    if (!statesRef.current.has(sid)) statesRef.current.set(sid, emptySessionState());
    return statesRef.current.get(sid)!;
  }

  // Current session's state for rendering
  const cur = getState(sessionId);

  const refreshSessions = useCallback(() => {
    getSessions().then(raw => {
      setSessions(raw
        .filter((s: Session) => s.source === 'user_chat' && s.message_count > 0)
        .map((s: Session) => ({
          id: s.id,
          title: s.title || 'New chat',
          preview: `${s.message_count} messages`,
          date: formatRelativeDate(s.created_at),
        })));
    }).catch(() => {});
  }, []);

  useEffect(() => { refreshSessions(); }, [refreshSessions]);

  const handleSend = useCallback(async (content: string) => {
    // Capture the session ID at send time — this request belongs to THIS session
    const sendSid = sessionId;
    const state = getState(sendSid);

    // Abort any previous in-flight request for this session
    if (state.abortController) state.abortController.abort();
    const controller = new AbortController();
    state.abortController = controller;

    // Add user message
    state.messages = [...state.messages, {
      id: Date.now().toString(),
      role: "user" as const,
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }];
    state.isProcessing = true;
    state.statusText = "Thinking...";
    state.streamingText = "";
    state.activityItems = [];
    state.elapsed = 0;
    state.startTime = Date.now();

    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      if (sessionId === sendSid) rerender();
    }, 1000);

    rerender();

    // Helper: update state and trigger re-render only if this session is visible
    const update = (fn: (s: SessionState) => void) => {
      fn(state);
      // Always rerender — React will diff and skip if sessionId changed
      rerender();
    };

    try {
      await sendMessageStream(content, {
        onActivity(item) {
          update(s => {
            if (item.kind === 'thinking' && s.activityItems.length > 0 && s.activityItems[s.activityItems.length - 1].kind === 'thinking') {
              s.activityItems = [...s.activityItems.slice(0, -1), item];
            } else {
              s.activityItems = [...s.activityItems, item];
            }
          });
        },
        onStatusChange(status) {
          update(s => { s.statusText = status; });
        },
        onStreamText(fullText) {
          update(s => { s.streamingText = fullText; });
        },
        onDone(event) {
          // If this was a new session (sendSid was null), adopt the server-assigned ID
          if (sendSid === null && event.session_id) {
            // Move state from null key to the real session ID
            statesRef.current.set(event.session_id, state);
            statesRef.current.delete(null);
            setSessionId(event.session_id);
          }

          for (const tc of event.tool_calls_made) {
            const idx = state.toolResults.findIndex(t => t.name === tc.name);
            const updated = [...state.toolResults];
            if (idx >= 0) updated[idx] = tc; else updated.push(tc);
            state.toolResults = updated;
          }

          const finalElapsed = Math.floor((Date.now() - state.startTime) / 1000);
          state.lastActivity = { items: state.activityItems, elapsed: finalElapsed };
          state.messages = [...state.messages, {
            id: (Date.now() + 1).toString(),
            role: "agent" as const,
            content: event.message,
            activity: state.activityItems.length > 0 ? [...state.activityItems] : undefined,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }];

          cleanup();
          refreshSessions();
          rerender();
        },
        onError(msg) {
          state.messages = [...state.messages, {
            id: (Date.now() + 1).toString(),
            role: "agent" as const,
            content: `Error: ${msg}`,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          }];
          cleanup();
          rerender();
        },
      }, sendSid ?? undefined, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return; // intentional abort, ignore
      state.messages = [...state.messages, {
        id: (Date.now() + 1).toString(),
        role: "agent" as const,
        content: `Connection error: ${err instanceof Error ? err.message : 'Unknown'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }];
      cleanup();
      rerender();
    }

    function cleanup() {
      state.isProcessing = false;
      state.streamingText = "";
      state.abortController = null;
      if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
    }
  }, [sessionId, rerender, refreshSessions]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await fetch(`/agent/sessions/${id}`, { method: 'DELETE' });
    statesRef.current.delete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (sessionId === id) {
      setSessionId(null);
      rerender();
    }
  }, [sessionId, rerender]);

  const handleNewSession = useCallback(() => {
    // Don't abort running requests — they continue in background for their session
    setSessionId(null);
    // Ensure clean state for the new null session
    statesRef.current.set(null, emptySessionState());
    rerender();
  }, [rerender]);

  const handleSelectSession = useCallback(async (id: string, dismissSidebar = false) => {
    setSessionId(id);
    if (dismissSidebar) setLeftOpen(false);

    // If we already have state for this session (e.g. it's still processing), just show it
    if (statesRef.current.has(id)) {
      rerender();
      return;
    }

    // Otherwise load from server
    const state = emptySessionState();
    try {
      const pastMessages = await loadSessionMessages(id);
      state.messages = pastMessages.map((m, i) => ({
        id: `${id}-${i}`,
        role: m.role,
        content: m.content,
        activity: m.activity,
      }));
    } catch { /* empty */ }
    statesRef.current.set(id, state);
    rerender();
  }, [rerender]);

  const toggleRightPanel = useCallback((panel: 'dashboard' | 'activity') => {
    setRightPanel(prev => prev === panel ? 'none' : panel);
  }, []);

  const handleShowActivity = useCallback((activity?: ActivityItem[]) => {
    if (activity) {
      const state = getState(sessionId);
      state.lastActivity = { items: activity, elapsed: 0 };
    }
    setRightPanel('activity');
  }, [sessionId]);

  const displayActivity = cur.isProcessing ? { items: cur.activityItems, elapsed: cur.elapsed } : cur.lastActivity;
  const hasActivity = displayActivity.items.length > 0;

  // Mark active session in sidebar
  const sessionsWithActive = sessions.map(s => ({ ...s, active: s.id === sessionId }));

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
        <div className="flex items-center gap-2">
          <button onClick={() => setConnectOpen(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent hover:bg-accent/90 transition-colors text-accent-foreground font-medium">
            <Plus className="w-3.5 h-3.5" />
            Connect an Account
          </button>
          <button onClick={() => toggleRightPanel('dashboard')} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <LayoutDashboard className="w-4 h-4" />
          </button>
          <button onClick={() => setSettingsOpen(true)} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="hidden md:flex">
          <ChatHistory sessions={sessionsWithActive} onSelect={(id) => handleSelectSession(id)} onNew={handleNewSession} onDelete={handleDeleteSession} isOpen={leftOpen} onToggle={() => setLeftOpen(false)} />
        </div>
        {leftOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={() => setLeftOpen(false)} />
            <div className="relative z-10">
              <ChatHistory sessions={sessionsWithActive} onSelect={(id) => handleSelectSession(id, true)} onNew={handleNewSession} onDelete={handleDeleteSession} isOpen={true} onToggle={() => setLeftOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <ChatArea
            messages={cur.messages}
            isProcessing={cur.isProcessing}
            statusText={cur.statusText}
            streamingText={cur.streamingText}
            hasActivity={hasActivity}
            onSend={handleSend}
            onShowActivity={handleShowActivity}
          />
        </div>

        <div className="hidden md:flex">
          {rightPanel === 'dashboard' && (
            <DashboardPanel isOpen={true} onToggle={() => setRightPanel('none')} toolResults={cur.toolResults} />
          )}
          {rightPanel === 'activity' && (
            <ActivityPanel isOpen={true} onClose={() => setRightPanel('none')} items={displayActivity.items} elapsed={displayActivity.elapsed} isStreaming={cur.isProcessing} />
          )}
        </div>
        {rightPanel !== 'none' && (
          <div className="md:hidden fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={() => setRightPanel('none')} />
            <div className="relative z-10">
              {rightPanel === 'dashboard' && (
                <DashboardPanel isOpen={true} onToggle={() => setRightPanel('none')} toolResults={cur.toolResults} />
              )}
              {rightPanel === 'activity' && (
                <ActivityPanel isOpen={true} onClose={() => setRightPanel('none')} items={displayActivity.items} elapsed={displayActivity.elapsed} isStreaming={cur.isProcessing} />
              )}
            </div>
          </div>
        )}
      </div>

      <ConnectAccountDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onAddConnection={() => setConnectOpen(true)} />
    </div>
  );
};

function formatRelativeDate(iso: string): string {
  const now = new Date();
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default AppLayout;
