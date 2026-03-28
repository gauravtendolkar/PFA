import { motion } from "framer-motion";

interface UserMessageProps {
  content: string;
  timestamp?: string;
}

const UserMessage = ({ content, timestamp }: UserMessageProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex justify-end mb-5"
    >
      <div className="max-w-[80%] md:max-w-[70%]">
        <div className="bg-chat-user text-chat-user-foreground rounded-lg rounded-br-sm px-4 py-3">
          <p className="text-[13px] leading-relaxed">{content}</p>
        </div>
        {timestamp && (
          <p className="text-[10px] text-muted-foreground mt-1 text-right pr-1">{timestamp}</p>
        )}
      </div>
    </motion.div>
  );
};

export default UserMessage;
