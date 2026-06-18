class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);

    // Return unsubscribe function
    return () => {
      this.off(event, callback);
    };
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event).filter((cb) => cb !== callback);
    this.listeners.set(event, callbacks);
  }

  emit(event, payload) {
    // Fire specific listeners
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((callback) => {
        try { callback(payload); } catch (err) { console.error(`Error in event listener for ${event}:`, err); }
      });
    }
    // Fire wildcard listeners
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach((callback) => {
        try { callback(payload); } catch (err) { console.error(`Error in wildcard listener:`, err); }
      });
    }
  }
}

export const NetworkEventBus = new EventBus();
