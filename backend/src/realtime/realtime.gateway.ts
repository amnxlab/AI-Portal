import {
    WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket,
    OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

const allowedOrigins = () =>
    (process.env.FRONTEND_URL ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);

/** Rooms a client may ask to join. Per-user rooms are assigned by the server only. */
const JOINABLE_ROOM = /^(project-|comment-)[A-Za-z0-9_-]{1,80}$/;

@WebSocketGateway({
    namespace: '/',
    cors: {
        origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => {
            // No Origin header = same-origin or a non-browser client.
            cb(null, !origin || allowedOrigins().includes(origin));
        },
        credentials: true,
    },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private readonly logger = new Logger(RealtimeGateway.name);

    /**
     * The handshake token is VERIFIED (signature + expiry), not just decoded.
     * Previously anyone on the network could connect, forge a `sub`, and join
     * another user's room. An invalid or missing token is disconnected, and
     * only the server places a socket in its `user:<id>` room.
     */
    handleConnection(client: Socket) {
        const token = client.handshake.auth?.token as string | undefined;
        try {
            if (!token) throw new Error('missing token');
            const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'default_secret_change_me') as Record<string, any>;
            if (!payload?.sub) throw new Error('token has no subject');
            client.data.userId = payload.sub;
            client.join(`user:${payload.sub}`);
        } catch (err: any) {
            client.emit('unauthorized', { message: 'Invalid or expired session' });
            client.disconnect(true);
            return;
        }
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('join-room')
    handleJoinRoom(@ConnectedSocket() client: Socket, @MessageBody() room: string) {
        if (!client.data?.userId || typeof room !== 'string' || !JOINABLE_ROOM.test(room)) return;
        client.join(room);
        client.emit('joined', room);
    }

    broadcastTaskUpdate(task: any) {
        this.server.to(`project-${task.projectId}`).emit('task:updated', task);
        this.server.emit('task:updated', task); // broadcast to all for dashboard
    }

    broadcastInventoryUpdate(item: any) {
        this.server.emit('inventory:updated', item);
    }

    broadcastReportSubmitted(report: any) {
        this.server.emit('report:submitted', report);
    }

    /**
     * Broadcast a new comment to all clients subscribed to the entity room.
     * Frontend clients join `comment-task-<id>`, `comment-ticket-<id>`, etc.
     */
    broadcastComment(comment: any) {
        const room = `comment-${comment.entityType}-${comment.entityId}`;
        this.server.to(room).emit('comment:new', comment);
    }

    /** Signal all connected reviewer dashboards to re-fetch their pending-review data. */
    broadcastDashboardRefresh() {
        this.server.emit('dashboard:refresh', {});
    }

    /** Push a new notification to a specific user's browser in real time. */
    broadcastNotification(userId: string, notif: any) {
        this.server.to(`user:${userId}`).emit('notification:new', notif);
    }

    // ─── Attendance / RFID ───────────────────────────────────────────────
    // These are content-free signals: the browser re-fetches through the
    // authenticated API, so no attendance data ever travels on the socket.

    /** The employee's own attendance changed (drives the header timer). */
    emitAttendanceChanged(userId: string) {
        this.server?.to(`user:${userId}`).emit('attendance:changed', {});
        this.emitAttendanceRefresh();
    }

    /** Something in organisation-wide attendance changed (admin screens re-fetch). */
    emitAttendanceRefresh() {
        this.server?.emit('attendance:refresh', {});
    }

    /** Progress of a card registration, sent only to the administrator who started it. */
    emitRfidRegistration(adminUserId: string | null, payload: { sessionId: string; userId: string; stage: string; message?: string }) {
        if (adminUserId) this.server?.to(`user:${adminUserId}`).emit('rfid:registration', payload);
        this.server?.emit('rfid:refresh', {});
    }
}
