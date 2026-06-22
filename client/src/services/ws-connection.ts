import type { WSMessage } from '../types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface ConnectionCallbacks {
  onOpen?: () => void;
  onMessage?: (message: WSMessage) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (error: Event) => void;
  onStateChange?: (state: ConnectionState) => void;
}

export interface WebSocketConnectionOptions {
  url: string;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
}

/**
 * Low-level WebSocket connection wrapper with automatic reconnection
 * (exponential back-off) and heartbeat / pong-timeout management.
 *
 * This class is protocol-agnostic — it knows nothing about notifications.
 * Reuse it for any WebSocket feature that needs resilient connectivity.
 */
export class WebSocketConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private callbacks: ConnectionCallbacks;
  private reconnectIntervalMs: number;
  private maxReconnectIntervalMs: number;
  private pingIntervalMs: number;
  private pongTimeoutMs: number;

  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private pongTimeoutTimer: number | null = null;
  private state: ConnectionState = 'disconnected';
  private shouldReconnect = true;

  constructor(options: WebSocketConnectionOptions, callbacks: ConnectionCallbacks = {}) {
    this.url = options.url;
    this.callbacks = callbacks;
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 3000;
    this.maxReconnectIntervalMs = options.maxReconnectIntervalMs ?? 30000;
    this.pingIntervalMs = options.pingIntervalMs ?? 25000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 10000;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    this.updateState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WS-Connection] Connected');
        this.reconnectAttempts = 0;
        this.updateState('connected');
        this.startHeartbeat();
        this.callbacks.onOpen?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.callbacks.onMessage?.(message);
        } catch {
          console.warn('[WS-Connection] Invalid message:', event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WS-Connection] Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.stopHeartbeat();
        this.updateState('disconnected');
        this.callbacks.onClose?.(event.code, event.reason);

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WS-Connection] Error:', error);
        this.callbacks.onError?.(error);
      };
    } catch (e) {
      console.error('[WS-Connection] Connection error:', e);
      this.updateState('disconnected');
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectIntervalMs
    );

    console.log(`[WS-Connection] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.updateState('reconnecting');

    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
        this.startPongTimeout();
      }
    }, this.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.stopPongTimeout();
  }

  private startPongTimeout(): void {
    this.stopPongTimeout();
    this.pongTimeoutTimer = window.setTimeout(() => {
      console.warn('[WS-Connection] Pong timeout, closing connection');
      this.ws?.close();
    }, this.pongTimeoutMs);
  }

  private stopPongTimeout(): void {
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private updateState(newState: ConnectionState): void {
    this.state = newState;
    this.callbacks.onStateChange?.(newState);
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.updateState('disconnected');
    this.reconnectAttempts = 0;
  }

  reconnect(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.disconnect();
    this.shouldReconnect = true;
    this.connect();
  }
}
