'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');

const defaultConfig = require('./src/config');
const { RoomManager } = require('./src/RoomManager');
const { attachRealtime } = require('./src/realtime');
const { log } = require('./src/utils');

function createApp({ config = defaultConfig, words } = {}) {
  const manager = new RoomManager({ config, words });
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/healthz', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), ...manager.stats() });
  });

  // No build step and no hashed file names: always revalidate (cheap 304s)
  // so players get new client code right after a deploy.
  app.use(
    express.static(path.join(__dirname, 'public'), {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
    })
  );

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: config.MAX_PAYLOAD_BYTES,
    pingInterval: 20000,
    pingTimeout: 25000,
  });
  const realtime = attachRealtime(io, manager, { config });
  const sweepTimer = setInterval(realtime.sweep, config.SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  function close() {
    clearInterval(sweepTimer);
    for (const room of manager.rooms.values()) clearTimeout(room.hostGraceTimer);
    return new Promise((resolve) => io.close(() => resolve()));
  }

  return { app, server, io, manager, close };
}

function start(port = defaultConfig.PORT) {
  const instance = createApp();
  instance.server.listen(port, () => log.info(`Server running on port ${port}`));

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received, shutting down`);
    instance.io.emit('notice', { type: 'error', message: 'The server is restarting. Current games will end.' });
    setTimeout(() => instance.close().then(() => process.exit(0)), 500).unref();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err));

  return instance;
}

if (require.main === module) start();

module.exports = { createApp, start };
