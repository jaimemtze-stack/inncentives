import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** One authenticated socket per tab (the session cookie authenticates it). */
export function getSocket(): Socket {
  socket ??= io({ path: '/socket.io', transports: ['websocket'], withCredentials: true });
  return socket;
}

export function closeSocket(): void {
  socket?.close();
  socket = null;
}

/** Refreshes cached ticket data when the server announces a change. */
export function useRealtimeInvalidation(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    const onTicket = (e: { ticketId: string }) => {
      void qc.invalidateQueries({ queryKey: ['ticket', e.ticketId] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['overviews'] });
    };
    const onNotification = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
    s.on('ticket', onTicket);
    s.on('notification', onNotification);
    return () => {
      s.off('ticket', onTicket);
      s.off('notification', onNotification);
    };
  }, [enabled, qc]);
}

export interface Viewer {
  id: string;
  name: string;
  typing: boolean;
}

/** Presence of other agents on a ticket (collision detection). */
export function usePresence(
  ticketId: string,
  enabled: boolean,
): {
  viewers: Viewer[];
  setTyping: (typing: boolean) => void;
} {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    const onPresence = (e: { ticketId: string; viewers: Viewer[] }) => {
      if (e.ticketId === ticketId) setViewers(e.viewers);
    };
    s.on('presence', onPresence);
    const watch = () => s.emit('ticket:watch', { ticketId });
    if (s.connected) watch();
    s.on('connect', watch);
    return () => {
      s.emit('ticket:unwatch', { ticketId });
      s.off('presence', onPresence);
      s.off('connect', watch);
    };
  }, [ticketId, enabled]);
  return {
    viewers,
    setTyping: (typing) => {
      if (enabled) getSocket().emit('ticket:typing', { ticketId, typing });
    },
  };
}
