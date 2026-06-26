import { NetworkEventBus } from '../../utils/NetworkEventBus';

interface ChatActionContext {
  isTyping: boolean;
  chatMessages: any[];
  isHost: boolean;
  connections: any[];
  playerId: string;
  playerName: string;
  players: Record<string, any>;
  addChatMessage: (text: string, type?: string, sender?: string) => void;
  processCommandIntent: (cmd: string, args: string[], senderId: string) => void;
}

export const createChatActions = (set: any, get: any): Record<string, any> => ({
    setTyping: (val: boolean) => set({ isTyping: val }),
    
    addChatMessage: (text: string, type = 'chat', sender = 'System') => set((state: any) => {
       const newMsg = { id: Math.random().toString(36).substring(2, 9), text, type, sender, timestamp: Date.now() };
       return { chatMessages: [...state.chatMessages, newMsg].slice(-50) };
    }),

  broadcastChatMessage: (text: string) => {
     const { connections, playerName, isHost } = get();
     const senderName = playerName || (isHost ? 'Host' : 'Guest');
     const msgData = { type: 'CHAT_MESSAGE', text, sender: senderName };
     connections.forEach((conn: any) => { try { conn.send(msgData); } catch(e: any) { console.warn("[Network] Dropped packet/action:", e.message); } });
     get().addChatMessage(text, 'chat', senderName);
  },
  
  broadcastSystemMessage: (text: string) => {
     const { connections, isHost } = get();
     if (!isHost) return;
     const msgData = { type: 'SYSTEM_MESSAGE', text };
     connections.forEach((conn: any) => { try { conn.send(msgData); } catch(e: any) { console.warn("[Network] Dropped packet/action:", e.message); } });
     get().addChatMessage(text, 'system', 'System');
  },
  
  executeCommand: (text: string) => {
    if (typeof text !== 'string' || !text.trim()) return;

    const args = text.trim().split(/\s+/);
    const cmd = args[0].toLowerCase();
    const state = get();

    if (cmd === '/help') {
      state.addChatMessage('Commands: /help, /gamemode <mode>, /weather <clear|rain>, /time set <day|night>, /tp @s <x y z>, /give @s <item> [amount], /op <player>, /deop <player>, /kick <player>', 'system', 'System');
      return;
    }

    if (state.isHost) {
      state.processCommandIntent(cmd, args, state.playerId);
    } else {
      if (state.connections[0]) {
        try {
           state.connections[0].send({ type: 'COMMAND_INTENT', cmd, args });
        } catch(e: any) { console.warn("[Network] Dropped packet/action:", e.message); }
      }
    }
  },

  processCommandIntent: (cmd: string, args: string[], senderId: string) => {
    if (typeof cmd !== 'string' || !Array.isArray(args)) return;

    NetworkEventBus.emit('SERVER_COMMAND', { type: 'SERVER_COMMAND', cmd, args, senderId });
  }
});
