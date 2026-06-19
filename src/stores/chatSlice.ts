import { create } from 'zustand';

interface ChatMessage {
  id: string;
  author: string;
  text: string;
  timestamp: number;
}

interface ChatSlice {
  chatMessages: ChatMessage[];
  isTyping: boolean;
}

export const useChatStore = create<ChatSlice>((_set) => ({
  chatMessages: [],
  isTyping: false,
}));
