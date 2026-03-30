import { useState, useRef, useEffect } from "react";
import { Cpu, ChevronDown, Check, Loader2 } from "lucide-react";
import type { Model } from "@/lib/api";

interface ModelSelectorProps {
  models: Model[];
  onSwitch: (modelId: string) => void;
  isSwitching: boolean;
}

const ModelSelector = ({ models, onSwitch, isSwitching }: ModelSelectorProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = models.find(m => m.active);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (models.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isSwitching}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {isSwitching ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Cpu className="w-3 h-3" />
        )}
        <span className="hidden sm:inline">{active?.name || "Model"}</span>
        <span className="sm:hidden">{active?.paramCount || ""}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-card shadow-lg z-50 py-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-3 py-1.5">
            Model
          </p>
          {models.map(model => (
            <button
              key={model.id}
              disabled={!model.available || isSwitching}
              onClick={() => {
                if (model.active) { setOpen(false); return; }
                onSwitch(model.id);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div>
                <p className="text-xs font-medium text-foreground">{model.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {model.paramCount} · {model.quantization}
                  {!model.available && " · not downloaded"}
                </p>
              </div>
              {model.active && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
