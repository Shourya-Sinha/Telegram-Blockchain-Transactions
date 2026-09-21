import { io } from 'socket.io-client';
import { useEffect, useRef } from 'react';

/**
 * Socket.IO singleton with a listener registry.
 * Components register via useSocketEvent() — handlers survive reconnects
 * and sockets created after mount (auth state changes).
 */
let socket = null;
const registry = new Map(); // event -> Set<fn>

export function connectSocket(token) {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  socket = io({
    path: '/socket.io',
    auth: { token: token || null },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
  });
  for (const [ev, fns] of registry) {
    for (const fn of fns) socket.on(ev, fn);
  }
  return socket;
}

export function getSocket() {
  return socket;
}

export function onSocketEvent(event, fn) {
  if (!registry.has(event)) registry.set(event, new Set());
  registry.get(event).add(fn);
  if (socket) socket.on(event, fn);
  return () => {
    registry.get(event)?.delete(fn);
    if (socket) socket.off(event, fn);
  };
}

export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onSocketEvent(event, (...args) => ref.current(...args)), [event]);
}

export function useSocketStatus() {
  const ref = useRef(null);
  useEffect(() => {
    const update = () => ref.current?.(Boolean(socket?.connected));
    const t = setInterval(update, 3000);
    update();
    return () => clearInterval(t);
  }, []);
  return ref;
}
