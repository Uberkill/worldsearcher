export type EventCallback<T = any> = (payload: T) => void;

class IdempotentEventBus {
  private listeners: Map<string, Map<string, EventCallback>>;

  constructor() {
    this.listeners = new Map(); // EventName -> Map(ListenerKey -> Callback)
  }

  /**
   * Subscribe to an event with a unique key.
   * Overwrites previous callbacks registered under the same key.
   * @param event The event name
   * @param key The unique listener key
   * @param callback The function to call
   * @returns unsubscribe function
   */
  on<T = any>(event: string, key: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Map());
    }
    this.listeners.get(event)!.set(key, callback);
    
    // Return unsubscribe handle
    return () => this.off(event, key);
  }

  /**
   * Unsubscribe a specific key.
   */
  off(event: string, key: string): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(key);
    }
  }

  /**
   * Emit an event to all registered listeners.
   * Safeguarded against cascading listener failures.
   */
  emit<T = any>(event: string, payload?: T): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    for (const [key, callback] of eventListeners.entries()) {
      try {
        callback(payload);
      } catch (error) {
        console.error(`[EventBus] Error in listener '${key}' for event '${event}':`, error);
        // Silent cascading prevention: let subsequent listeners run!
      }
    }
  }

  /**
   * Complete purge on world unload.
   */
  clear(): void {
    this.listeners.clear();
    console.log('[EventBus] All listeners purged successfully.');
  }
}

export const EventBus = new IdempotentEventBus();
