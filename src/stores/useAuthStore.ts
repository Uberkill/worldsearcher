import { create } from 'zustand';

// In production, this would be your VPS URL
const API_URL = 'http://localhost:3001/api';

const getStorage = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const setStorage = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch {}
};
const removeStorage = (key: string) => {
  try { localStorage.removeItem(key); } catch {}
};

const safeJson = async (res: Response) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid server response');
  }
};

interface AuthSlice {
  sessionToken: string | null;
  username: string | null;
  isAuthenticated: boolean;
  error: string | null;
  isLoading: boolean;
  setToken: (token: string | null, user: string | null) => void;
  register: (username: string, password: string) => Promise<string | null>;
  login: (username: string, password: string) => Promise<boolean>;
  recover: (username: string, recoveryCode: string, newPassword: string) => Promise<boolean>;
  logout: () => void;
  uploadSave: (vxBlob: Blob) => Promise<boolean>;
  downloadSave: () => Promise<Blob | null>;
}

export const useAuthStore = create<AuthSlice>((set, get) => ({
  sessionToken: getStorage('ws_session_token'),
  username: getStorage('ws_username'),
  isAuthenticated: !!getStorage('ws_session_token'),
  error: null,
  isLoading: false,

  setToken: (token, user) => {
    if (token && user) {
      setStorage('ws_session_token', token);
      setStorage('ws_username', user);
      set({ sessionToken: token, username: user, isAuthenticated: true, error: null });
    } else {
      removeStorage('ws_session_token');
      removeStorage('ws_username');
      set({ sessionToken: null, username: null, isAuthenticated: false });
    }
  },

  register: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Failed to register');

      get().setToken(data.sessionToken, data.username);
      set({ isLoading: false });
      return data.recoveryCode; // Return the code so UI can display it
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set({ error: errorMsg, isLoading: false });
      return null;
    }
  },

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Failed to login');

      get().setToken(data.sessionToken, data.username);
      set({ isLoading: false });
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set({ error: errorMsg, isLoading: false });
      return false;
    }
  },

  recover: async (username, recoveryCode, newPassword) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, recoveryCode, newPassword })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Failed to recover account');

      set({ isLoading: false, error: null });
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set({ error: errorMsg, isLoading: false });
      return false;
    }
  },

  logout: () => {
    get().setToken(null, null);
  },

  uploadSave: async (vxBlob) => {
    set({ isLoading: true, error: null });
    try {
      // Convert Blob to JSON string
      const text = await vxBlob.text();
      const res = await fetch(`${API_URL}/upload_save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${get().sessionToken}`
        },
        body: JSON.stringify({ payload: text })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      set({ isLoading: false });
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set({ error: errorMsg, isLoading: false });
      return false;
    }
  },

  downloadSave: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/download_save`, {
        headers: { 'Authorization': `Bearer ${get().sessionToken}` }
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Download failed');
      
      if (!data?.payload) throw new Error('Malformed save data received');

      set({ isLoading: false });

      // Convert returned JSON string payload back into a Blob
      return new Blob([data.payload], { type: 'application/json' });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      set({ error: errorMsg, isLoading: false });
      return null;
    }
  }
}));
