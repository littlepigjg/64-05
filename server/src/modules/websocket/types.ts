import type { WebSocket } from 'ws';

export interface ClientConnection {
  ws: WebSocket;
  id: string;
  connectedAt: number;
  lastPing: number;
}
