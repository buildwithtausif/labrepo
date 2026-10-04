import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export async function initClientSocket() {
  if (socket) return socket;
  
  if (!window.Clerk || !window.Clerk.session) {
    return null;
  }
  
  const token = await window.Clerk.session.getToken();
  if (!token) return null;

  const backendUrl = window.API_BASE_URL || 'http://localhost:3001';

  socket = io(backendUrl, {
    auth: {
      token
    },
    transports: ['websocket', 'polling'], // Fallback
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected to real-time server', socket?.id);
    // On reconnect, we can trigger re-fetches for missed events
    window.dispatchEvent(new CustomEvent('socket:connected'));
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('[Socket] Connection Error:', error);
  });

  // Global event listeners
  socket.on('friend_request', (data) => {
    // Dispatch a custom event so UI components can react
    window.dispatchEvent(new CustomEvent('circles:friend_request', { detail: data }));
  });

  socket.on('friend_accepted', (data) => {
    window.dispatchEvent(new CustomEvent('circles:friend_accepted', { detail: data }));
  });

  socket.on('friend_removed', (data) => {
    window.dispatchEvent(new CustomEvent('circles:friend_removed', { detail: data }));
  });

  socket.on('new_message', (data) => {
    window.dispatchEvent(new CustomEvent('circles:new_message', { detail: data }));
  });

  socket.on('message_deleted', (data) => {
    window.dispatchEvent(new CustomEvent('circles:message_deleted', { detail: data }));
  });

  socket.on('messages_read', (data) => {
    window.dispatchEvent(new CustomEvent('circles:messages_read', { detail: data }));
  });

  socket.on('chat_deleted_for_everyone', (data) => {
    window.dispatchEvent(new CustomEvent('circles:chat_deleted_for_everyone', { detail: data }));
  });

  return socket;
}

export function getClientSocket() {
  return socket;
}
