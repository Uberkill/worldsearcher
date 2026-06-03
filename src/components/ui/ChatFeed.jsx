import React, { useState, useEffect, useRef } from 'react';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare } from 'lucide-react';

export const ChatFeed = () => {
  const { chatMessages, isTyping, setTyping, broadcastChatMessage } = useNetworkStore();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Auto-hide messages after inactivity
  const [showHistory, setShowHistory] = useState(false);
  const hideTimeoutRef = useRef(null);

  useEffect(() => {
    if (chatMessages.length > 0) {
      setShowHistory(true);
      resetHideTimeout();
    }
  }, [chatMessages.length]);

  useEffect(() => {
    if (isTyping) {
      setShowHistory(true);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      resetHideTimeout();
      inputRef.current?.blur();
    }
  }, [isTyping]);

  const resetHideTimeout = () => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    if (!isTyping) {
      hideTimeoutRef.current = setTimeout(() => setShowHistory(false), 8000);
    }
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, showHistory]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim()) {
      broadcastChatMessage(inputValue.trim());
      setInputValue('');
    }
    setTyping(false);
  };

  const handleKeyDown = (e) => {
    e.stopPropagation(); // VERY IMPORTANT: prevents game from processing this key!
    if (e.key === 'Escape') {
      setTyping(false);
    }
  };

  return (
    <div className="absolute left-8 bottom-28 w-80 flex flex-col pointer-events-none z-[60]">
      <div 
        className={`flex flex-col space-y-1 mb-2 transition-opacity duration-500 overflow-y-auto max-h-64 scrollbar-hide ${showHistory ? 'opacity-100' : 'opacity-0'}`}
        style={{ WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 15%, black)', maskImage: 'linear-gradient(to bottom, transparent, black 15%, black)' }}
      >
        <AnimatePresence initial={false}>
          {chatMessages.map(msg => (
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
                <span className="font-bold text-cyan-400 mr-2">{msg.sender}:</span>
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
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onMouseDown={e => e.stopPropagation()}
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
