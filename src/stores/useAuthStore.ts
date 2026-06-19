import { create } from 'zustand';

// In production, this would be your VPS URL
const API_URL = 'http://localhost:3001/api';

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
  sessionToken: localStorage.getItem('ws_session_token') || null,
  username: localStorage.getItem('ws_username') || null,
  isAuthenticated: !!localStorage.getItem('ws_session_token'),
  error: null,
  isLoading: false,

  setToken: (token, user) => {
    if (token) {
      localStorage.setItem('ws_session_token', token);
      localStorage.setItem('ws_username', user!);
      set({ sessionToken: token, username: user, isAuthenticated: true, error: null });
    } else {
      localStorage.removeItem('ws_session_token');
      localStorage.removeItem('ws_username');
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register');

      get().setToken(data.sessionToken, data.username);
      set({ isLoading: false });
      return data.recoveryCode; // Return the code so UI can display it
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to login');

      get().setToken(data.sessionToken, data.username);
      set({ isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to recover account');

      set({ isLoading: false, error: null });
      return true;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      set({ isLoading: false });
      return true;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      return false;
    }
  },

  downloadSave: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/download_save`, {
        headers: { 'Authorization': `Bearer ${get().sessionToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download failed');

      set({ isLoading: false });

      // Convert returned JSON string payload back into a Blob
      return new Blob([data.payload], { type: 'application/json' });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      return null;
    }
  }
}));
