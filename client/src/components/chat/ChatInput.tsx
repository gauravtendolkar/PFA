import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Mic } from "lucide-react";
import { motion } from "framer-motion";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSend, disabled = false }: ChatInputProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [message]);

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-3 md:p-4">
      <div className="glass-surface rounded-2xl flex items-end gap-2 p-2 max-w-3xl mx-auto">
        <button className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted">
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your finances..."
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent resize-none text-sm py-2 px-1 placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50 max-h-[120px] scrollbar-thin"
        />
        <button className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted">
          <Mic className="w-4 h-4" />
        </button>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className="p-2 bg-primary text-primary-foreground rounded-xl disabled:opacity-30 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  );
};

export default ChatInput;
