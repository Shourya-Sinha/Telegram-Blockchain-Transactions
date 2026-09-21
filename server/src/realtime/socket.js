const { Server } = require('socket.io');
const env = require('../config/env');

/**
 * Realtime layer (Socket.IO).
 *
 * Rooms:
 *   public       — everyone (blocks, public tx feed, chain ticks, mempool pings)
 *   user:{id}    — one user (tx submitted/confirmed/failed, notifications)
 *   admin        — all admins (api pulse hits, approval requests, presence)
 *
 * Auth is optional: anonymous sockets still get the public feed.
 */
let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    },
  });

  const { verifyToken } = require('../utils/jwt');

  io.use((socket, next) => {
    socket.join('public');
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (token) {
      try {
        const p = verifyToken(token);
        socket.userId = p.id;
        socket.role = p.role;
        socket.join('user:' + p.id);
        if (p.role === 'admin') socket.join('admin');
      } catch (_) {
        /* invalid token → stay anonymous, public feed only */
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    socket.emit('hello', { time: new Date().toISOString(), online: onlineCount() });
    io.to('admin').emit('presence', { online: onlineCount() });
    socket.on('disconnect', () => {
      io.to('admin').emit('presence', { online: onlineCount() });
    });
  });

  console.log('[realtime] socket.io ready');
  return io;
}

function emitPublic(evt, data) {
  if (io) io.to('public').emit(evt, data);
}

function emitUser(userId, evt, data) {
  if (io && userId) io.to('user:' + String(userId)).emit(evt, data);
}

function emitAdmin(evt, data) {
  if (io) io.to('admin').emit(evt, data);
}

function emitAll(evt, data) {
  if (io) io.emit(evt, data);
}

function onlineCount() {
  try {
    return io ? io.engine.clientsCount : 0;
  } catch (_) {
    return 0;
  }
}

function getIO() {
  return io;
}

module.exports = { initSocket, emitPublic, emitUser, emitAdmin, emitAll, onlineCount, getIO };
