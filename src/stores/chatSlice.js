import { create } from 'zustand';

export const useChatStore = create((_set) => ({
  chatMessages: [],
  isTyping: false,
}));
