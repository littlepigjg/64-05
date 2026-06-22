export { WebSocketConnection, type ConnectionState, type ConnectionCallbacks, type WebSocketConnectionOptions } from './ws-connection';
export { WebSocketService, type WebSocketServiceOptions } from './ws-client';
import type { WebSocketServiceOptions } from './ws-client';
import { WebSocketService } from './ws-client';

let wsServiceInstance: WebSocketService | null = null;

export function getWebSocketService(): WebSocketService {
  if (!wsServiceInstance) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/notifications`;
    wsServiceInstance = new WebSocketService({ url: wsUrl });
  }
  return wsServiceInstance;
}

export function initWebSocketService(
  options: Omit<WebSocketServiceOptions, 'url'>
): WebSocketService {
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
