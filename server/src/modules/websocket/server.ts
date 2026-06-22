import http from 'http';
import { WebSocketServer } from 'ws';
import { ClientManager } from './client-manager';
import { getNotificationManager } from '../notifications';
import type { WSMessage, Notification } from '../../types';
import type { ClientConnection } from './types';

const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 10000;

/**
 * WebSocket server specialised for real-time notification delivery.
 *
 * Delegates connection bookkeeping to {@link ClientManager} and
 * notification persistence/history to {@link NotificationManager},
 * keeping this class focused on the WS protocol and heartbeat logic.
 */
export class WebSocketNotificationServer {
  private wss: WebSocketServer | null = null;
  private clientManager = new ClientManager();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  attachTo(server: http.Server): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ server, path: '/ws/notifications' });

    this.wss.on('connection', (ws) => {
      const conn = this.clientManager.add(ws);

      this.sendHistory(ws);

      ws.on('message', (data) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(conn, message);
        } catch {
          console.warn('[WebSocket] Invalid message:', data.toString());
        }
      });

      ws.on('pong', () => {
        const c = this.clientManager.get(conn.id);
        if (c) {
          c.lastPing = Date.now();
        }
      });

      ws.on('close', () => {
        this.clientManager.remove(conn.id);
      });

      ws.on('error', (err) => {
        console.error(`[WebSocket] Client error ${conn.id}:`, err);
        this.clientManager.remove(conn.id);
      });
    });

    this.startHeartbeat();
    console.log('[WebSocket] Server attached');
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      this.clientManager.forEach((conn) => {
        if (now - conn.lastPing > PING_INTERVAL_MS + PONG_TIMEOUT_MS) {
          console.log(`[WebSocket] Client timeout: ${conn.id}`);
          conn.ws.terminate();
          this.clientManager.remove(conn.id);
        } else if (now - conn.lastPing > PING_INTERVAL_MS) {
          try {
            conn.ws.ping();
          } catch {
            conn.ws.terminate();
            this.clientManager.remove(conn.id);
          }
        }
      });
    }, PING_INTERVAL_MS);
  }

  private handleMessage(conn: ClientConnection, message: WSMessage): void {
    const notificationManager = getNotificationManager();

    switch (message.type) {
      case 'ping':
        this.clientManager.send(conn.ws, { type: 'pong' });
        break;
      case 'pong':
        conn.lastPing = Date.now();
        break;
      case 'history':
        this.sendHistory(conn.ws, message.payload?.limit, message.payload?.offset);
        break;
      case 'mark_read':
        if (message.payload?.id) {
          notificationManager.markAsRead(message.payload.id);
          this.broadcastHistory();
        } else if (message.payload?.all) {
          notificationManager.markAllAsRead();
          this.broadcastHistory();
        }
        break;
      case 'settings':
        break;
    }
  }

  private sendHistory(ws: import('ws').WebSocket, limit: number = 50, offset: number = 0): void {
    const result = getNotificationManager().getNotifications(limit, offset);
    this.clientManager.send(ws, {
      type: 'history_response',
      payload: result,
    });
  }

  broadcastNotification(notification: Notification): void {
    const sent = this.clientManager.broadcast({
      type: 'notification',
      payload: notification,
    });
    console.log(`[WebSocket] Broadcast notification to ${sent} clients: ${notification.id}`);
  }

  private broadcastHistory(): void {
    const result = getNotificationManager().getNotifications(50, 0);
    this.clientManager.broadcast({
      type: 'history_response',
      payload: result,
    });
  }

  getClientCount(): number {
    return this.clientManager.size();
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.clientManager.closeAll();

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
