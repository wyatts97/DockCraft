/**
 * socket.js — shared Socket.io connection for live console + stats.
 *
 * Connects to the same origin the dashboard is served from. The connection is
 * lazily created and reused across page modules that need real-time data.
 * The JWT is forwarded in the `auth` payload so the server's socketAuth
 * middleware can verify it on the handshake. On auth failure the server
 * drops the connection; we surface that by clearing the local token and
 * bouncing to the login page (mirrors apiFetch's 401 behavior).
 */

import { io } from 'socket.io-client';
import { getToken, clearToken } from './api';

let socket = null;

export function getSocket() {
  if (socket) {
    // If the user logged in (or out) after the socket was created, force a
    // reconnect so the new token is sent on the next handshake.
    const want = getToken() || null;
    if (socket.auth?.token !== want) {
      socket.auth = { token: want };
      socket.disconnect();
      socket.connect();
    }
    return socket;
  }
  socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1500,
    auth: () => ({ token: getToken() || undefined }),
  });
  socket.on('connect_error', (err) => {
    if (/Authentication|token/i.test(err.message || '')) {
      clearToken();
      if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
    }
  });
  return socket;
}
