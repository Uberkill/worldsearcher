import { vi } from 'vitest';

class Worker {
  constructor(stringUrl) {
    this.url = stringUrl;
    this.onmessage = () => {};
  }
  postMessage(msg) {
    // Intelligent bounce-back to prevent test Promises from hanging
    setTimeout(() => {
      if (this.onmessage) {
        // Return a generic mocked response based on the message type
        this.onmessage({ data: { type: msg.type, status: 'mocked_success', buffer: new ArrayBuffer(0) } });
      }
    }, 0);
  }
}

global.Worker = Worker;
