import api from './axios';

/* ═══════════════════════════════════════════════════════════════════════
   RFID API.

   Cards are registered from the employee's own profile: an administrator
   opens a short registration window on a named reader, and the next card
   presented to that reader becomes that employee's card. A card that is
   merely seen by a reader is never assigned on its own.
   ═══════════════════════════════════════════════════════════════════════ */

/** How an employee's card provisioning stands. */
export type RfidSyncStatus = 'synced' | 'pending' | 'failed' | 'disabled';

export type RegistrationStatus = 'waiting' | 'success' | 'failed' | 'expired' | 'cancelled';

/** Progress stages pushed over the socket while a card is being registered. */
export type RegistrationStage =
    | 'waiting' | 'card_detected' | 'validating' | 'registering'
    | 'success' | 'failed' | 'expired' | 'cancelled'
    | 'reader_online' | 'reader_updated' | 'card_removed';

export interface RfidDevice {
    id: string;
    /** The identifier the reader announces in X-Device-Id, e.g. RFID-SM2-001. */
    deviceId: string;
    name: string;
    location: string | null;
    isActive: boolean;
    firmwareVersion: string | null;
    ipAddress: string | null;
    lastSeenAt: string | null;
    lastScanAt: string | null;
    createdAt: string;
    /** Has polled recently enough to be considered reachable. */
    online: boolean;
}

/** Returned once, at creation or key rotation. The key is never readable again. */
export interface DeviceWithKey {
    device: RfidDevice;
    apiKey: string;
}

export interface RfidCardRef {
    id: string;
    uid: string;
    assignedAt: string;
    assignedByName?: string | null;
}

export interface RfidCardHistoryEntry {
    id: string;
    uid: string;
    status: 'active' | 'replaced' | 'removed';
    assignedAt: string;
    assignedByName: string | null;
    revokedAt: string | null;
    revokedByName: string | null;
    revokeReason: string | null;
}

export interface RegistrationSession {
    id: string;
    userId: string;
    deviceId: string;
    mode: 'register' | 'replace';
    status: RegistrationStatus;
    cardUid: string | null;
    failureReason: string | null;
    expiresAt: string;
    createdAt: string;
    completedAt: string | null;
    /** Seconds left in the window; 0 once it is no longer waiting. */
    secondsLeft: number;
    device?: { id: string; deviceId: string; name: string; online: boolean };
}

export interface RfidEvent {
    id: string;
    kind: string;
    result: string;
    detail: string | null;
    uid: string | null;
    deviceCode: string | null;
    ipAddress: string | null;
    createdAt: string;
    employeeName: string | null;
    employeeId: string | null;
}

/** Everything the RFID section of an employee's profile needs. */
export interface UserRfid {
    /** Invited but has not finished signing up. Not a disabled account. */
    pendingSignup?: boolean;
    userId: string;
    fullName: string;
    employeeId: string | null;
    isActive: boolean;
    status: RfidSyncStatus;
    card: RfidCardRef | null;
    activeRegistration: RegistrationSession | null;
    lastRegistration: RegistrationSession | null;
    history: RfidCardHistoryEntry[];
    recentEvents: Array<{ id: string; kind: string; result: string; detail: string | null; createdAt: string }>;
    devices: RfidDevice[];
}

export interface EmployeeRfidStatus {
    userId: string;
    fullName: string;
    employeeId: string | null;
    isActive: boolean;
    status: RfidSyncStatus;
    /** A registration window is open for this employee right now. */
    registering: boolean;
    hasEmployeeId: boolean;
    card: { id: string; uid: string; assignedAt: string } | null;
    lastRegistration: { status: RegistrationStatus; failureReason: string | null; createdAt: string } | null;
}

export interface RfidStatusResult {
    readers: { total: number; online: number };
    employees: EmployeeRfidStatus[];
}

/* ─── Readers ───────────────────────────────────────────────────────── */

export const listDevices = () =>
    api.get<RfidDevice[]>('/rfid/devices').then((r) => r.data);

/** The API key is in this response only — show it once, then it is gone. */
export const createDevice = (body: { deviceId: string; name: string; location?: string }) =>
    api.post<DeviceWithKey>('/rfid/devices', body).then((r) => r.data);

export const updateDevice = (id: string, body: { name?: string; location?: string; isActive?: boolean }) =>
    api.patch<RfidDevice>(`/rfid/devices/${id}`, body).then((r) => r.data);

/** Issues a new key; the reader's old key stops working immediately. */
export const rotateDeviceKey = (id: string) =>
    api.post<DeviceWithKey>(`/rfid/devices/${id}/rotate-key`).then((r) => r.data);

export const deleteDevice = (id: string) =>
    api.delete(`/rfid/devices/${id}`).then((r) => r.data);

/* ─── Status and event log ──────────────────────────────────────────── */

export const getStatuses = () =>
    api.get<RfidStatusResult>('/rfid/status').then((r) => r.data);

export const listEvents = (q: { limit?: number; deviceId?: string; userId?: string } = {}) =>
    api.get<RfidEvent[]>('/rfid/events', { params: q }).then((r) => r.data);

/* ─── Registration sessions ─────────────────────────────────────────── */

export const getRegistration = (id: string) =>
    api.get<RegistrationSession>(`/rfid/registrations/${id}`).then((r) => r.data);

export const cancelRegistration = (id: string) =>
    api.delete<RegistrationSession>(`/rfid/registrations/${id}`).then((r) => r.data);

/* ─── An employee's card ────────────────────────────────────────────── */

export const getUserRfid = (userId: string) =>
    api.get<UserRfid>(`/users/${userId}/rfid`).then((r) => r.data);

/** Opens the registration window: the next card at this reader is theirs. */
export const startRegistration = (
    userId: string,
    body: { deviceId?: string; mode?: 'register' | 'replace'; allowPending?: boolean } = {},
) => api.post<RegistrationSession>(`/users/${userId}/rfid/registration`, body).then((r) => r.data);

/** Revokes the card. It stops producing attendance immediately. */
export const removeCard = (userId: string, reason: string) =>
    api.delete(`/users/${userId}/rfid/card`, { data: { reason } }).then((r) => r.data);

/* ─── Presentation helpers ──────────────────────────────────────────── */

export const SYNC_STATUS_LABEL: Record<RfidSyncStatus, string> = {
    synced: 'Synced',
    pending: 'Pending registration',
    failed: 'Registration failed',
    disabled: 'Disabled',
};

/** Human wording for each stage of the registration window. */
export const STAGE_LABEL: Partial<Record<RegistrationStage, string>> = {
    waiting: 'Waiting for RFID card…',
    card_detected: 'Card detected',
    validating: 'Validating card…',
    registering: 'Registering card…',
    success: 'Registration successful',
    failed: 'Registration failed',
    expired: 'Registration window closed',
    cancelled: 'Registration cancelled',
};

/** Groups a card UID into byte pairs for display: A1B2C3D4 → A1 B2 C3 D4. */
export const formatUid = (uid: string | null | undefined): string =>
    uid ? (uid.match(/.{1,2}/g) ?? [uid]).join(' ') : '—';
