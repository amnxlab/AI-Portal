import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

type EventHandler = (data: any) => void;

export function useSocket(events: Record<string, EventHandler> = {}) {
    const socketRef = useRef<Socket | null>(null);
    const token = useAuthStore((s) => s.accessToken);

    useEffect(() => {
        if (!token) return;

        // VITE_SOCKET_URL is set by start-dev.sh. Fall back to the page's own
        // origin so socket.io connects to whatever host served the page — works
        // for both dev (https://portal.lan) and production.
        const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? window.location.origin;

        const socket = io(SOCKET_URL, {
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('[Socket] Connected:', socket.id);
        });

        socket.on('disconnect', () => {
            console.log('[Socket] Disconnected');
        });

        socket.on('connect_error', (err) => {
            console.warn('[Socket] Connection error:', err.message);
        });

        // Register custom event handlers
        Object.entries(events).forEach(([event, handler]) => {
            socket.on(event, handler);
        });

        return () => {
            Object.entries(events).forEach(([event, handler]) => {
                socket.off(event, handler);
            });
            socket.disconnect();
            socketRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    const joinRoom = useCallback((room: string) => {
        socketRef.current?.emit('join-room', room);
    }, []);

    const on = useCallback((event: string, handler: EventHandler) => {
        socketRef.current?.on(event, handler);
    }, []);

    const off = useCallback((event: string, handler?: EventHandler) => {
        if (handler) {
            socketRef.current?.off(event, handler);
        } else {
            socketRef.current?.removeAllListeners(event);
        }
    }, []);

    return { socket: socketRef.current, joinRoom, on, off };
}
