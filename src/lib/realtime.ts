/**
 * WS-клиент реалтайм-уведомлений (/ws).
 *
 * Передаёт только факт изменения ревизии; источник истины — HTTP-снимки.
 * Переподключение с экспоненциальным backoff и верхней границей 15 секунд.
 */

export type RealtimeStatus = "connecting" | "open" | "closed";

export interface RealtimeMessage {
  type: string;
  revision?: number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

export function realtimeUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

export class GameRealtime {
  private ws: WebSocket | null = null;
  private disposed = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private status: RealtimeStatus = "closed";
  private statusListeners = new Set<(status: RealtimeStatus) => void>();
  private openListeners = new Set<() => void>();
  private messageListeners = new Set<(msg: RealtimeMessage) => void>();

  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  onStatus(cb: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onOpen(cb: () => void): () => void {
    this.openListeners.add(cb);
    return () => this.openListeners.delete(cb);
  }

  onMessage(cb: (msg: RealtimeMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  start(): void {
    if (this.disposed) return;
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((cb) => cb(status));
  }

  private connect(): void {
    if (this.disposed) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.disposed) return;
      this.attempts = 0;
      this.setStatus("open");
      this.openListeners.forEach((cb) => cb());
    };

    ws.onmessage = (event) => {
      if (this.disposed) return;
      try {
        const msg = JSON.parse(String(event.data)) as RealtimeMessage;
        if (msg && typeof msg.type === "string") {
          this.messageListeners.forEach((cb) => cb(msg));
        }
      } catch {
        /* не JSON — игнорируем */
      }
    };

    ws.onclose = () => {
      if (this.disposed) return;
      this.ws = null;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // close придёт следом и запланирует reconnect
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.setStatus("closed");
    const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** this.attempts);
    const jitter = Math.random() * 300;
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, exp + jitter);
  }
}
