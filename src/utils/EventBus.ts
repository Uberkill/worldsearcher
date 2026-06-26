interface EventMap {
  'audio': { sound: string; source: 'local' | 'remote' };
  'EVENT_BLOCK_DESTROYED': {
    x: number;
    y: number;
    z: number;
    texName: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chestItems?: any[];
    causedByGravity?: boolean;
    initiatedByPlayerId?: string;
  };
}

type EventCallback<K extends keyof EventMap> = (payload: EventMap[K]) => void;

class IdempotentEventBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Map<keyof EventMap, Map<string, any>>;

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
  on<K extends keyof EventMap>(event: K, key: string, callback: EventCallback<K>): () => void {
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
  off<K extends keyof EventMap>(event: K, key: string): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(key);
    }
  }

  /**
   * Emit an event to all registered listeners.
   * Safeguarded against cascading listener failures.
   */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    for (const [key, callback] of eventListeners) {
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
