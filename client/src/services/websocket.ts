import type { WSMessage, Notification, NotificationListResponse, WSMessageType } from '../types';

type MessageHandler = (message: WSMessage) => void;
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface WebSocketServiceOptions {
  url: string;
  onNotification?: (notification: Notification) => void;
  onHistoryUpdate?: (data: NotificationListResponse) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
  pingIntervalMs?: number;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private reconnectIntervalMs: number;
  private maxReconnectIntervalMs: number;
  private pingIntervalMs: number;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private pongTimeoutTimer: number | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private messageHandlers: Map<WSMessageType, Set<MessageHandler>> = new Map();
  private onNotification?: (notification: Notification) => void;
  private onHistoryUpdate?: (data: NotificationListResponse) => void;
  private onConnectionChange?: (state: ConnectionState) => void;
  private shouldReconnect = true;
  private lastMessageTime = 0;

  constructor(options: WebSocketServiceOptions) {
    this.url = options.url;
    this.onNotification = options.onNotification;
    this.onHistoryUpdate = options.onHistoryUpdate;
    this.onConnectionChange = options.onConnectionChange;
    this.reconnectIntervalMs = options.reconnectIntervalMs || 3000;
    this.maxReconnectIntervalMs = options.maxReconnectIntervalMs || 30000;
    this.pingIntervalMs = options.pingIntervalMs || 25000;
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    this.updateConnectionState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.updateConnectionState('connected');
        this.send({ type: 'history', payload: { limit: 50 } });
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (e) {
          console.warn('[WebSocket] Invalid message:', event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.stopPing();
        this.updateConnectionState('disconnected');

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };
    } catch (e) {
      console.error('[WebSocket] Connection error:', e);
      this.updateConnectionState('disconnected');
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

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.updateConnectionState('reconnecting');

    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.onConnectionChange?.(state);
  }

  private startPing(): void {
    this.stopPing();

    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
        this.startPongTimeout();
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.stopPongTimeout();
  }

  private startPongTimeout(): void {
    this.stopPongTimeout();
    this.pongTimeoutTimer = window.setTimeout(() => {
      console.warn('[WebSocket] Pong timeout, closing connection');
      this.ws?.close();
    }, 10000);
  }

  private stopPongTimeout(): void {
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case 'notification':
        this.onNotification?.(message.payload as Notification);
        break;
      case 'history_response':
        this.onHistoryUpdate?.(message.payload as NotificationListResponse);
        break;
      case 'pong':
        this.stopPongTimeout();
        break;
    }

    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
  }

  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  markAsRead(notificationId: string): void {
    this.send({
      type: 'mark_read',
      payload: { id: notificationId },
    });
  }

  markAllAsRead(): void {
    this.send({
      type: 'mark_read',
      payload: { all: true },
    });
  }

  requestHistory(limit: number = 50, offset: number = 0): void {
    this.send({
      type: 'history',
      payload: { limit, offset },
    });
  }

  on(type: WSMessageType, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    return () => {
      this.messageHandlers.get(type)?.delete(handler);
    };
  }

  getState(): ConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.updateConnectionState('disconnected');
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

let wsServiceInstance: WebSocketService | null = null;

export function getWebSocketService(): WebSocketService {
  if (!wsServiceInstance) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/notifications`;
    wsServiceInstance = new WebSocketService({ url: wsUrl });
  }
  return wsServiceInstance;
}

export function initWebSocketService(options: Omit<WebSocketServiceOptions, 'url'>): WebSocketService {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/notifications`;

  if (wsServiceInstance) {
    wsServiceInstance.disconnect();
  }

  wsServiceInstance = new WebSocketService({
    url: wsUrl,
    ...options,
  });

  return wsServiceInstance;
}
