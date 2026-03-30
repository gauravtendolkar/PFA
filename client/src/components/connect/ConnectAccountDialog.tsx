import { useState, useCallback } from "react";
import { X, Building2, Loader2, ExternalLink, ClipboardPaste } from "lucide-react";

const SIMPLEFIN_CREATE_URL = "https://bridge.simplefin.org/simplefin/create";

interface ConnectAccountDialogProps {
  open: boolean;
  onClose: () => void;
}

const ConnectAccountDialog = ({ open, onClose }: ConnectAccountDialogProps) => {
  const [step, setStep] = useState<"intro" | "token" | "syncing" | "done" | "error">("intro");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setStep("intro");
    setSetupToken("");
    setError("");
  }, []);

  const handleClaim = useCallback(async () => {
    if (!setupToken.trim()) return;
    setStep("syncing");
    try {
      const res = await fetch("/simplefin/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setup_token: setupToken.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      // Trigger initial sync
      await fetch("/simplefin/sync", { method: "POST" });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStep("error");
    }
  }, [setupToken]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setSetupToken(text);
    } catch { /* clipboard API may not be available */ }
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-display text-lg font-semibold text-foreground">Connect Bank Account</h2>
          <button onClick={handleClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {step === "done" ? (
            <div className="text-center py-6">
              <div className="text-green-500 text-3xl mb-2">&#10003;</div>
              <p className="text-foreground font-medium">Account connected!</p>
              <p className="text-sm text-muted-foreground mt-1">Your transactions are syncing.</p>
              <button onClick={handleClose} className="mt-4 px-4 py-2 bg-accent text-accent-foreground rounded-md text-sm font-medium hover:bg-accent/90 transition-colors">
                Done
              </button>
            </div>
          ) : step === "syncing" ? (
            <div className="text-center py-6">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-3">Connecting and syncing your accounts...</p>
            </div>
          ) : step === "error" ? (
            <div className="text-center py-6">
              <p className="text-destructive font-medium">Connection failed</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <button onClick={() => setStep("token")} className="mt-4 px-4 py-2 bg-secondary text-foreground rounded-md text-sm font-medium hover:bg-secondary/80 transition-colors">
                Try again
              </button>
            </div>
          ) : step === "token" ? (
            <div className="space-y-4">
              <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium text-foreground">Steps:</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Click below to open SimpleFIN Bridge</li>
                  <li>Sign up or log in, then connect your bank</li>
                  <li>Copy the <strong>Setup Token</strong> they give you</li>
                  <li>Paste it below</li>
                </ol>
              </div>

              <a
                href={SIMPLEFIN_CREATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 transition-colors"
              >
                Open SimpleFIN Bridge
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Setup Token</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={setupToken}
                    onChange={e => setSetupToken(e.target.value)}
                    placeholder="Paste your setup token here..."
                    className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button onClick={handlePaste} className="p-2 rounded-md border border-border hover:bg-secondary transition-colors text-muted-foreground" title="Paste from clipboard">
                    <ClipboardPaste className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep("intro")} className="flex-1 px-4 py-2 text-sm rounded-md border border-border hover:bg-secondary transition-colors text-foreground">
                  Back
                </button>
                <button
                  onClick={handleClaim}
                  disabled={!setupToken.trim()}
                  className="flex-1 px-4 py-2 text-sm rounded-md bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Connect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => setStep("token")}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:border-accent hover:bg-secondary/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground text-sm">Connect via SimpleFIN</p>
                  <p className="text-xs text-muted-foreground">Secure bank connection via SimpleFIN Bridge</p>
                </div>
              </button>

              <p className="text-xs text-center text-muted-foreground pt-1">
                SimpleFIN connects to major US banks. $1.50/month paid directly to SimpleFIN.
                <br />No API keys or developer accounts needed.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectAccountDialog;
