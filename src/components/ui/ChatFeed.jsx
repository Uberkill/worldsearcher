import { useState, useEffect, useRef, useCallback } from 'react';
import { networkActions } from '../../stores/networkActions';
import { useChatStore } from '../../stores/chatSlice';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare } from 'lucide-react';

export const ChatFeed = () => {
  const chatMessages = useChatStore((state) => state.chatMessages);
  const isTyping = useChatStore((state) => state.isTyping);
  const setTyping = networkActions((state) => state.setTyping);
  const broadcastChatMessage = networkActions((state) => state.broadcastChatMessage);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Auto-hide messages after inactivity
  const [showHistory, setShowHistory] = useState(false);
  const hideTimeoutRef = useRef(null);

  const resetHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    if (!isTyping) {
      hideTimeoutRef.current = setTimeout(() => setShowHistory(false), 8000);
    }
  }, [isTyping]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (chatMessages.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowHistory(true);
      resetHideTimeout();
    }
  }, [chatMessages.length, resetHideTimeout]);

  useEffect(() => {
    if (isTyping) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowHistory(true);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      resetHideTimeout();
      inputRef.current?.blur();
    }
  }, [isTyping, resetHideTimeout]);



  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showHistory]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (text) {
      if (text.startsWith('/')) {
        const { executeCommand, addChatMessage } = networkActions.getState();
        if (text === '/help') {
          addChatMessage(
            'Commands: /help, /weather <clear|rain>, /time set <day|night>, /give <player|@s> <item> [amount], /tp <player|@s> [target|x y z], /kick <player>',
            'system'
          );
        } else {
          if (executeCommand) executeCommand(text);
        }
      } else {
        broadcastChatMessage(text);
      }
      setInputValue('');
    }
    setTyping(false);
  };

  const handleKeyDown = (e) => {
    e.stopPropagation(); // VERY IMPORTANT: prevents game from processing this key!
    if (e.key === 'Escape') {
      setTyping(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const text = inputValue.toLowerCase();
      const commands = ['/help', '/weather', '/time', '/give', '/tp', '/kick', '/gamemode'];
      if (text.startsWith('/')) {
        const match = commands.find((c) => c.startsWith(text));
        if (match) setInputValue(match + ' ');
      }
    }
  };

  return (
    <div className="w-80 flex flex-col pointer-events-none z-[60]">
      <div
        className={`flex flex-col space-y-1 mb-2 transition-opacity duration-500 overflow-y-auto max-h-64 scrollbar-hide ${showHistory ? 'opacity-100' : 'opacity-0'}`}
        style={{
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 15%, black)',
          maskImage:
            'linear-gradient(to bottom, transparent, black 15%, black)',
        }}
      >
        <AnimatePresence initial={false}>
          {chatMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className={`text-sm px-3 py-1.5 rounded-lg w-max max-w-full break-words backdrop-blur-md border ${
                msg.type === 'system'
                  ? 'bg-yellow-500/20 text-yellow-200 border-yellow-500/30 italic font-light'
                  : 'bg-black/60 text-white border-white/10'
              }`}
            >
              {msg.type === 'chat' && (
                <span className="font-bold text-cyan-400 mr-2">
                  {msg.sender}:
                </span>
              )}
              <span>{msg.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      <AnimatePresence>
        {isTyping && (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onSubmit={handleSubmit}
            className="pointer-events-auto bg-black/80 backdrop-blur-xl border border-cyan-500/50 p-2 rounded-xl flex items-center shadow-[0_0_15px_rgba(34,211,238,0.2)]"
          >
            <MessageSquare size={16} className="text-cyan-400 ml-2 mr-3" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Type to chat..."
              maxLength={100}
              className="bg-transparent border-none outline-none text-white text-sm w-full font-sans"
            />
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};
