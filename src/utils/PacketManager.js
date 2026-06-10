// src/utils/PacketManager.js

/**
 * A robust PacketManager to wrap WebRTC DataChannel operations.
 * It prevents silent swallowing of buffer-overflow exceptions by implementing
 * an internal queue and an exponential backoff retry system.
 */
class PacketManager {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.pendingAcks = new Map(); // sequenceId -> { packet, timestamp, retries, conn }
    this.sequenceCounter = 0;
    
    // Start ACK cleanup loop
    this.ackInterval = setInterval(() => this._processAcks(), 1000);
  }

  /**
   * Safely sends a packet. If the WebRTC buffer is full, it queues the packet.
   * If requireAck is true, the packet will be repeatedly sent until an ACK is received.
   */
  send(conn, data, requireAck = false) {
    if (!conn || !conn.open) return false;

    // Attach sequence ID for ACK tracking if requested
    if (requireAck && typeof data === 'object') {
      data.__seq = ++this.sequenceCounter;
      this.pendingAcks.set(data.__seq, {
        packet: data,
        conn,
        timestamp: Date.now(),
        retries: 0
      });
    }

    this.queue.push({ conn, data });
    this._processQueue();
    return true;
  }

  /**
   * Handles incoming ACKs from peers.
   */
  handleAck(seqId) {
    if (this.pendingAcks.has(seqId)) {
      this.pendingAcks.delete(seqId);
    }
  }

  _processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { conn, data } = this.queue[0];

      if (!conn || !conn.open) {
        // Connection died, discard packet
        this.queue.shift();
        continue;
      }

      // Check if buffer is getting dangerously full (e.g. > 1MB)
      if (conn.bufferedAmount > 1024 * 1024) {
        // Pause processing, wait for buffer to drain
        setTimeout(() => {
          this.isProcessing = false;
          this._processQueue();
        }, 50);
        return;
      }

      try {
        conn.send(data);
        this.queue.shift(); // Success, remove from queue
      } catch (err) {
        // Buffer overflow or underlying socket issue.
        console.warn(`[PacketManager] Send failed, re-queueing. Buffer: ${conn.bufferedAmount} bytes`, err);
        // Pause and backoff
        setTimeout(() => {
          this.isProcessing = false;
          this._processQueue();
        }, 100);
        return;
      }
    }

    this.isProcessing = false;
  }

  _processAcks() {
    const now = Date.now();
    for (const [seqId, req] of this.pendingAcks.entries()) {
      if (now - req.timestamp > 2000) { // Retry after 2 seconds
        if (req.retries >= 5) {
          console.warn(`[PacketManager] Dropping reliable packet ${seqId} after 5 failed retries.`);
          this.pendingAcks.delete(seqId);
        } else {
          console.log(`[PacketManager] Resending un-ACK'd packet ${seqId} (Attempt ${req.retries + 1})`);
          req.timestamp = now;
          req.retries++;
          this.queue.push({ conn: req.conn, data: req.packet });
          this._processQueue();
        }
      }
    }
  }

  terminate() {
    clearInterval(this.ackInterval);
  }
}

export const packetManager = new PacketManager();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    packetManager.terminate();
  });
}
