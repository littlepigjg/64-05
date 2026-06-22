import type { WebSocket } from 'ws';
import type { WSMessage } from '../../types';
import type { ClientConnection } from './types';

/**
 * Manages the lifecycle and broadcasting for connected WebSocket clients.
 *
 * Extracted from the server so the connection bookkeeping (add / remove /
 * iterate / heartbeat) can be reused or tested independently of the
 * notification-specific message protocol.
 */
export class ClientManager {
  private clients: Map<string, ClientConnection> = new Map();

  add(ws: WebSocket): ClientConnection {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const connection: ClientConnection = {
      ws,
      id: clientId,
      connectedAt: Date.now(),
      lastPing: Date.now(),
    };
    this.clients.set(clientId, connection);
    console.log(`[WebSocket] Client connected: ${clientId}, total: ${this.clients.size}`);
    return connection;
  }

  remove(clientId: string): void {
    if (this.clients.delete(clientId)) {
      console.log(`[WebSocket] Client removed: ${clientId}, total: ${this.clients.size}`);
    }
  }

  get(clientId: string): ClientConnection | undefined {
    return this.clients.get(clientId);
  }

  send(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  broadcast(message: WSMessage): number {
    let sent = 0;
    for (const conn of this.clients.values()) {
      if (conn.ws.readyState === conn.ws.OPEN) {
        conn.ws.send(JSON.stringify(message));
        sent++;
      }
    }
    return sent;
  }

  forEach(callback: (conn: ClientConnection) => void): void {
    for (const conn of this.clients.values()) {
      callback(conn);
    }
  }

  size(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const conn of this.clients.values()) {
      conn.ws.close();
    }
    this.clients.clear();
  }
}
