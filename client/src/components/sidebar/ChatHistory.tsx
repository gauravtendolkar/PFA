import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, MessageSquare, Search, ChevronLeft } from "lucide-react";

interface ChatSession {
  id: string;
  title: string;
  preview: string;
  date: string;
  active?: boolean;
}

interface ChatHistoryProps {
  sessions: ChatSession[];
  onSelect: (id: string) => void;
  onNew: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

const ChatHistory = ({ sessions, onSelect, onNew, isOpen, onToggle }: ChatHistoryProps) => {
  const [search, setSearch] = useState("");

  const filtered = sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) ||
      s.preview.toLowerCase().includes(search.toLowerCase())
  );

  // Group by date
  const grouped: Record<string, ChatSession[]> = {};
  filtered.forEach((s) => {
    const key = s.date;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className="h-full border-r border-border bg-card flex flex-col overflow-hidden flex-shrink-0"
        >
          {/* Header */}
          <div className="p-3 flex items-center justify-between border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Chats</h2>
            <div className="flex gap-1">
              <button
                onClick={onNew}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={onToggle}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="w-full bg-muted rounded-lg text-xs pl-8 pr-3 py-2 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          {/* Sessions */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
            {Object.entries(grouped).map(([date, items]) => (
              <div key={date} className="mb-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-2 mb-1.5">
                  {date}
                </p>
                {items.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => onSelect(session.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg mb-0.5 transition-colors group ${
                      session.active
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{session.title}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {session.preview}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ChatHistory;
