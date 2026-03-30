import { useState, useEffect, useCallback } from "react";
import { X, Building2, Trash2, Plus, Loader2, RefreshCw, FileText } from "lucide-react";

interface Connection {
  id: string;
  institution_name: string;
  status: string;
  last_synced_at: string | null;
  created_at: string;
  account_count: number;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onAddConnection: () => void;
}

const SettingsDialog = ({ open, onClose, onAddConnection }: SettingsDialogProps) => {
  const [tab, setTab] = useState<"connections" | "prompt">("connections");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [promptTags, setPromptTags] = useState<string[]>([]);
  const [promptSaved, setPromptSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/simplefin/connections");
      if (res.ok) setConnections(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchPrompt = useCallback(async () => {
    try {
      const res = await fetch("/settings/prompt");
      if (res.ok) {
        const data = await res.json();
        setPrompt(data.content);
        setPromptTags(data.tags || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchConnections();
      fetchPrompt();
      setPromptSaved(false);
    }
  }, [open, fetchConnections, fetchPrompt]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its accounts/transactions?`)) return;
    await fetch(`/simplefin/connections/${id}`, { method: "DELETE" });
    setConnections(prev => prev.filter(c => c.id !== id));
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/simplefin/sync", { method: "POST" });
      await fetchConnections();
    } catch { /* ignore */ }
    setSyncing(false);
  }, [fetchConnections]);

  const handleSavePrompt = useCallback(async () => {
    const res = await fetch("/settings/prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: prompt }),
    });
    if (res.ok) {
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    }
  }, [prompt]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h2 className="font-display text-lg font-semibold text-foreground">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          <button
            onClick={() => setTab("connections")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${tab === "connections" ? "text-foreground border-b-2 border-accent" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Connections
          </button>
          <button
            onClick={() => setTab("prompt")}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${tab === "prompt" ? "text-foreground border-b-2 border-accent" : "text-muted-foreground hover:text-foreground"}`}
          >
            <FileText className="w-3.5 h-3.5" />
            System Prompt
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "connections" ? (
            <div className="space-y-3">
              {loading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : connections.length === 0 ? (
                <div className="text-center py-8">
                  <Building2 className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">No bank connections yet.</p>
                </div>
              ) : (
                connections.map(conn => (
                  <div key={conn.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{conn.institution_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {conn.account_count} account{conn.account_count !== 1 ? "s" : ""}
                        {conn.last_synced_at ? ` · Synced ${formatRelative(conn.last_synced_at)}` : ""}
                        <span className={`ml-1.5 ${conn.status === "active" ? "text-emerald-500" : "text-destructive"}`}>
                          {conn.status === "active" ? "Active" : conn.status}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(conn.id, conn.institution_name)}
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      title="Delete connection"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => { onClose(); onAddConnection(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Connection
                </button>
                {connections.length > 0 && (
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                    Sync
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Edit the system prompt sent to the LLM. Available tags:</p>
                <div className="flex gap-1.5 flex-wrap">
                  {promptTags.map(tag => (
                    <code key={tag} className="px-1.5 py-0.5 rounded bg-secondary text-foreground">{tag}</code>
                  ))}
                </div>
              </div>
              <textarea
                value={prompt}
                onChange={e => { setPrompt(e.target.value); setPromptSaved(false); }}
                className="w-full h-64 px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-accent"
                spellCheck={false}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {promptSaved ? <span className="text-emerald-500">Saved!</span> : "Changes take effect on next message."}
                </p>
                <button
                  onClick={handleSavePrompt}
                  className="px-4 py-2 text-sm rounded-md bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function formatRelative(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default SettingsDialog;
