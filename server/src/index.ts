import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { config } from './config';
import { npmRouter, pypiRouter } from './modules/proxy';
import { privatePkgRouter } from './modules/private-pkg';
import { getMetadataIndex } from './modules/metadata';
import { getCacheStorage } from './modules/cache';
import { getWebSocketServer } from './modules/websocket';
import { getNotificationManager } from './modules/notifications';
import { getVersionChecker } from './modules/version-check';
import { ensureDir } from './utils';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use('/api', privatePkgRouter);
app.use('/npm', npmRouter);
app.use('/pypi', pypiRouter);

const clientDistDir = path.resolve(process.cwd(), '..', 'client', 'dist');
app.use(express.static(clientDistDir));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '1.0.0',
    config: {
      storageDir: config.storageDir,
      port: config.port,
      npmUpstream: config.npm.upstream,
      pypiUpstream: config.pypi.upstream,
      privateScopes: config.npm.privateScopes,
    },
  });
});

app.get('/api/notifications', (req, res) => {
  const notificationManager = getNotificationManager();
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const result = notificationManager.getNotifications(limit, offset);
  res.json(result);
});

app.post('/api/notifications/:id/read', (req, res) => {
  const notificationManager = getNotificationManager();
  const success = notificationManager.markAsRead(req.params.id);
  res.json({ success });
});

app.post('/api/notifications/read-all', (_req, res) => {
  const notificationManager = getNotificationManager();
  const count = notificationManager.markAllAsRead();
  res.json({ success: true, count });
});

app.delete('/api/notifications/:id', (req, res) => {
  const notificationManager = getNotificationManager();
  const success = notificationManager.deleteNotification(req.params.id);
  res.json({ success });
});

app.delete('/api/notifications', (_req, res) => {
  const notificationManager = getNotificationManager();
  const count = notificationManager.clearAll();
  res.json({ success: true, count });
});

app.post('/api/notifications/force-check', async (_req, res) => {
  const versionChecker = getVersionChecker();
  const results = await versionChecker.forceCheck();
  res.json({ success: true, updates: results });
});

app.get('/api/notifications/diagnostics', (_req, res) => {
  const notificationManager = getNotificationManager();
  res.json(notificationManager.getDiagnostics());
});

app.get('*', (_req, res) => {
  const indexPath = path.join(clientDistDir, 'index.html');
  const fallbackPath = path.join(__dirname, 'public', 'fallback.html');
  res.sendFile(indexPath, (_err) => {
    res.sendFile(fallbackPath);
  });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

ensureDir(config.storageDir);
ensureDir(config.dataDir);

const metadata = getMetadataIndex();
const cache = getCacheStorage();

setInterval(() => {
  try {
    cache.cleanupTemp();
    metadata.recordStorageSnapshot();
  } catch (e) {
    console.error('Periodic task error:', e);
  }
}, 60 * 60 * 1000);

setTimeout(() => {
  try {
    metadata.recordStorageSnapshot();
  } catch (e) {
    console.error('Initial snapshot error:', e);
  }
}, 5000);

const wsServer = getWebSocketServer();
wsServer.attachTo(server);

const notificationManager = getNotificationManager();
const versionChecker = getVersionChecker();
versionChecker.start();

server.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     Local Registry Proxy v1.0.0                          ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  📊 Web UI:       http://localhost:${config.port}                     ║
║                                                          ║
║  📦 NPM Registry: http://localhost:${config.port}/npm                  ║
║     npm config set registry http://localhost:${config.port}/npm       ║
║                                                          ║
║  🐍 PyPI Index:   http://localhost:${config.port}/pypi/simple/         ║
║     pip install -i http://localhost:${config.port}/pypi/simple/ ...    ║
║                                                          ║
║  🔌 WebSocket:    ws://localhost:${config.port}/ws/notifications      ║
║                                                          ║
║  🔒 Private Scopes: ${config.npm.privateScopes.join(', ').padEnd(30)} ║
║                                                          ║
║  💾 Storage:      ${config.storageDir.padEnd(42)}║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  metadata.close();
  notificationManager.close();
  wsServer.close();
  versionChecker.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  metadata.close();
  notificationManager.close();
  wsServer.close();
  versionChecker.stop();
  process.exit(0);
});
