import { useState, useEffect, useCallback } from "react";
import { usePlaidLink } from "react-plaid-link";
import { X, Building2, Loader2, ExternalLink } from "lucide-react";

interface AppConfig {
  plaid: { enabled: boolean; env: string };
}

interface ConnectAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

const ConnectAccountDialog = ({ open, onClose }: ConnectAccountDialogProps) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "syncing" | "done" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setStatus("idle");
      setLinkToken(null);
      setError("");
      fetch("/config").then(r => r.json()).then(setConfig).catch(() => {});
    }
  }, [open]);

  const startPlaidLink = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/plaid/link-token", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      const { link_token } = await res.json();
      setLinkToken(link_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link token");
      setStatus("error");
    }
  }, []);

  const onPlaidSuccess = useCallback(async (publicToken: string) => {
    setStatus("syncing");
    try {
      const res = await fetch("/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token: publicToken }),
      });
      if (!res.ok) throw new Error(await res.text());

      // Trigger initial sync
      await fetch("/plaid/sync", { method: "POST" });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link account");
      setStatus("error");
    }
  }, []);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken,
    onSuccess: (publicToken) => onPlaidSuccess(publicToken),
    onExit: () => {
      if (status !== "syncing" && status !== "done") setStatus("idle");
    },
  });

  // Auto-open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && plaidReady) {
      openPlaid();
    }
  }, [linkToken, plaidReady, openPlaid]);

  if (!open) return null;

  const plaidEnabled = config?.plaid.enabled;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display text-lg font-semibold text-foreground">Connect Bank Account</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {status === "done" ? (
            <div className="text-center py-6">
              <div className="text-green-500 text-3xl mb-2">&#10003;</div>
              <p className="text-foreground font-medium">Account connected!</p>
              <p className="text-sm text-muted-foreground mt-1">Your transactions are syncing.</p>
              <button onClick={onClose} className="mt-4 px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 transition-colors">
                Done
              </button>
            </div>
          ) : status === "syncing" ? (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-3">Syncing your accounts and transactions...</p>
            </div>
          ) : status === "loading" ? (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-3">Opening Plaid Link...</p>
            </div>
          ) : status === "error" ? (
            <div className="text-center py-6">
              <p className="text-destructive font-medium">Connection failed</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <button onClick={() => setStatus("idle")} className="mt-4 px-4 py-2 bg-secondary text-foreground rounded-md text-sm font-medium hover:bg-secondary/80 transition-colors">
                Try again
              </button>
            </div>
          ) : !plaidEnabled ? (
            <div className="space-y-4 py-2">
              <div className="text-center">
                <Building2 className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
                <p className="text-foreground font-medium">Plaid not configured</p>
                <p className="text-sm text-muted-foreground mt-1">
                  PFA uses Plaid to securely connect your bank accounts.
                </p>
              </div>

              <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">How to set up (5 min):</p>
                <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>Sign up at <strong>dashboard.plaid.com</strong> (free)</li>
                  <li>Go to Team Settings &gt; Keys</li>
                  <li>Copy your <strong>client_id</strong> and <strong>Development secret</strong></li>
                  <li>Add them to your <code className="bg-secondary px-1 rounded">.env</code> file</li>
                  <li>Restart PFA</li>
                </ol>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                Development mode is free (100 connections). No business verification needed.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={startPlaidLink}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-accent hover:bg-secondary/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-blue-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">Connect via Plaid</p>
                  <p className="text-xs text-muted-foreground">Securely link your bank account</p>
                </div>
              </button>

              <p className="text-xs text-center text-muted-foreground">
                Plaid securely connects to 12,000+ US financial institutions.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectAccountDialog;
