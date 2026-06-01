/**
 * socket.js — shared Socket.io connection for live console + stats.
 *
 * Connects to the same origin the dashboard is served from. The connection is
 * lazily created and reused across page modules that need real-time data.
 */

import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (socket) return socket;
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500,
  });
  return socket;
}
