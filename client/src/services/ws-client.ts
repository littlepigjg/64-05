import { WebSocketConnection, type ConnectionState } from './ws-connection';
import type {
  WSMessage,
  Notification,
  NotificationListResponse,
  WSMessageType,
} from '../types';

type MessageHandler = (message: WSMessage) => void;

export interface WebSocketServiceOptions {
  url: string;
  onNotification?: (notification: Notification) => void;
  onHistoryUpdate?: (data: NotificationListResponse) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
  pingIntervalMs?: number;
}

/**
 * High-level WebSocket client for the notification system.
 *
 * Wraps {@link WebSocketConnection} with notification-specific protocol
 * handling: dispatches `notification` and `history_response` messages to
 * callbacks, and provides typed send helpers (`markAsRead`, `requestHistory`).
 */
export class WebSocketService {
  private connection: WebSocketConnection;
  private messageHandlers: Map<WSMessageType, Set<MessageHandler>> = new Map();
  private onNotification?: (notification: Notification) => void;
  private onHistoryUpdate?: (data: NotificationListResponse) => void;

  constructor(options: WebSocketServiceOptions) {
    this.onNotification = options.onNotification;
    this.onHistoryUpdate = options.onHistoryUpdate;

    this.connection = new WebSocketConnection(
      {
        url: options.url,
        reconnectIntervalMs: options.reconnectIntervalMs,
        maxReconnectIntervalMs: options.maxReconnectIntervalMs,
        pingIntervalMs: options.pingIntervalMs,
      },
      {
        onOpen: () => {
          // On (re)connect, request the latest history so the client
          // is always in sync with the server's durable state.
          this.requestHistory(50);
        },
        onMessage: (message) => this.handleMessage(message),
        onStateChange: options.onConnectionChange,
      }
    );
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  reconnect(): void {
    this.connection.reconnect();
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
        break;
    }

    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
  }

  send(message: WSMessage): void {
    this.connection.send(message);
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
    return this.connection.getState();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }
}
