import { vi } from 'vitest';

class Worker {
  url: string;
  onmessage: ((event: any) => void) | null;
  constructor(stringUrl: string) {
    this.url = stringUrl;
    this.onmessage = () => {};
  }
  postMessage(msg: any) {
    // Intelligent bounce-back to prevent test Promises from hanging
    setTimeout(() => {
      if (this.onmessage) {
        // Return a generic mocked response based on the message type
        this.onmessage({ data: { type: msg.type, status: 'mocked_success', buffer: new ArrayBuffer(0) } });
      }
    }, 0);
  }
}

(globalThis as any).Worker = Worker;

if (typeof window !== 'undefined') {
  if (!window.sessionStorage) {
    const store: Record<string, string> = {};
    (window as any).sessionStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => { store[key] = String(val); },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    };
  }
  if (!window.location || typeof window.location.reload !== 'function') {
    (window as any).location = {
      ...(window.location || {}),
      reload: vi.fn(),
    };
  }
}
