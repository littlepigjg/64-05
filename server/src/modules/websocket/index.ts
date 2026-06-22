import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getNotificationManager } from '../notifications';
import type { WSMessage, Notification } from '../../types';

interface ClientConnection {
  ws: WebSocket;
  id: string;
  connectedAt: number;
  lastPing: number;
}

export class WebSocketNotificationServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientConnection> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private notificationManager = getNotificationManager();
  private pingIntervalMs = 30000;
  private pongTimeoutMs = 10000;

  attachTo(server: http.Server): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ server, path: '/ws/notifications' });

    this.wss.on('connection', (ws) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const connection: ClientConnection = {
        ws,
        id: clientId,
        connectedAt: Date.now(),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, connection);
      console.log(`[WebSocket] Client connected: ${clientId}, total: ${this.clients.size}`);

      this.sendHistory(ws);

      ws.on('message', (data) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(clientId, message);
        } catch (e) {
          console.warn('[WebSocket] Invalid message:', data.toString());
        }
      });

      ws.on('pong', () => {
        const conn = this.clients.get(clientId);
        if (conn) {
          conn.lastPing = Date.now();
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WebSocket] Client disconnected: ${clientId}, total: ${this.clients.size}`);
      });

      ws.on('error', (err) => {
        console.error(`[WebSocket] Client error ${clientId}:`, err);
        this.clients.delete(clientId);
      });
    });

    this.startHeartbeat();
    console.log('[WebSocket] Server attached');
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [clientId, conn] of this.clients.entries()) {
        if (now - conn.lastPing > this.pingIntervalMs + this.pongTimeoutMs) {
          console.log(`[WebSocket] Client timeout: ${clientId}`);
          conn.ws.terminate();
          this.clients.delete(clientId);
        } else if (now - conn.lastPing > this.pingIntervalMs) {
          try {
            conn.ws.ping();
          } catch (e) {
            conn.ws.terminate();
            this.clients.delete(clientId);
          }
        }
      }
    }, this.pingIntervalMs);
  }

  private handleMessage(clientId: string, message: WSMessage): void {
    const conn = this.clients.get(clientId);
    if (!conn) return;

    switch (message.type) {
      case 'ping':
        this.send(conn.ws, { type: 'pong' });
        break;
      case 'pong':
        conn.lastPing = Date.now();
        break;
      case 'history':
        this.sendHistory(conn.ws, message.payload?.limit, message.payload?.offset);
        break;
      case 'mark_read':
        if (message.payload?.id) {
          this.notificationManager.markAsRead(message.payload.id);
          this.broadcastUpdate();
        } else if (message.payload?.all) {
          this.notificationManager.markAllAsRead();
          this.broadcastUpdate();
        }
        break;
      case 'settings':
        break;
    }
  }

  private send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendHistory(ws: WebSocket, limit: number = 50, offset: number = 0): void {
    const result = this.notificationManager.getNotifications(limit, offset);
    this.send(ws, {
      type: 'history_response',
      payload: result,
    });
  }

  broadcastNotification(notification: Notification): void {
    const message: WSMessage = {
      type: 'notification',
      payload: notification,
    };

    for (const conn of this.clients.values()) {
      this.send(conn.ws, message);
    }

    console.log(`[WebSocket] Broadcast notification to ${this.clients.size} clients: ${notification.id}`);
  }

  private broadcastUpdate(): void {
    const result = this.notificationManager.getNotifications(50, 0);
    const message: WSMessage = {
      type: 'history_response',
      payload: result,
    };

    for (const conn of this.clients.values()) {
      this.send(conn.ws, message);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const conn of this.clients.values()) {
      conn.ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[WebSocket] Server closed');
  }
}

let wsServerInstance: WebSocketNotificationServer | null = null;

export function getWebSocketServer(): WebSocketNotificationServer {
  if (!wsServerInstance) {
    wsServerInstance = new WebSocketNotificationServer();
  }
  return wsServerInstance;
}
