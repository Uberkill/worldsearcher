export type NetworkEventCallback<T = any> = (payload: T) => void;

class EventBus {
  private listeners: Map<string, NetworkEventCallback[]>;

  constructor() {
    this.listeners = new Map();
  }

  on<T = any>(event: string, callback: NetworkEventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);

    // Return unsubscribe function
    return () => {
      this.off(event, callback);
    };
  }

  off<T = any>(event: string, callback: NetworkEventCallback<T>): void {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event)!.filter((cb) => cb !== callback);
    this.listeners.set(event, callbacks);
  }

  emit<T = any>(event: string, payload?: T): void {
    // Fire specific listeners
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach((callback) => {
        try { callback(payload); } catch (err) { console.error(`Error in event listener for ${event}:`, err); }
      });
    }
    // Fire wildcard listeners
    if (this.listeners.has('*')) {
      this.listeners.get('*')!.forEach((callback) => {
        try { callback(payload); } catch (err) { console.error(`Error in wildcard listener:`, err); }
      });
    }
  }
}

export const NetworkEventBus = new EventBus();
