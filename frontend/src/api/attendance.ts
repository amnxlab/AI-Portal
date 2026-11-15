import api from './axios';

/* ═══════════════════════════════════════════════════════════════════════
   Attendance API.

   Every figure here is computed by the server from the central
   attendance_sessions table. The browser only renders it — there is
   deliberately no endpoint for editing or deleting an attendance record,
   because corrections go through the audited session routes instead.
   ═══════════════════════════════════════════════════════════════════════ */

export type SessionMode = 'onsite' | 'remote';
export type SessionStatus = 'open' | 'closed' | 'incomplete' | 'voided';
export type AttendanceSource =
    | 'manual' | 'csv_import' | 'online_portal' | 'rfid' | 'admin_correction';

/** One working session: a clock-in paired with its clock-out. */
export interface SessionView {
    id: string;
    userId: string;
    mode: SessionMode;
    source: AttendanceSource | string;
    status: SessionStatus | string;
    /** True when an administrator has moved a timestamp on this session. */
    corrected: boolean;
    clockInAt: string;
    clockOutAt: string | null;
    /** The timestamps as originally recorded. Never change. */
    originalInAt: string | null;
    originalOutAt: string | null;
    /** Worked hours — 0 until the session is closed. */
    hours: number;
    user?: { id: string; fullName: string; employeeId: string | null };
}

export interface RemotePolicy {
    allowed: boolean;
    percent: number;
    maxHours: number | null;
    /** Weekly remote ceiling implied by percent and maxHours. 0 when not authorised. */
    limitHours: number;
}

export interface RemoteUsage extends RemotePolicy {
    actualHours: number;
    /** Remote hours that count as verified: min(actual, limit). */
    creditedHours: number;
    remainingHours: number;
    exceeded: boolean;
}

/** What an employee may report for a week, and what they already have. */
export interface WeekBalance {
    weekStart: string;
    /** True when report hours for this week are bounded by verified attendance. */
    enforcement: boolean;
    onsiteHours: number;
    verifiedHours: number;
    weeklyHoursCap: number | null;
    reportedHours: number;
    reportedRemoteHours: number;
    reportStatus: string | null;
    /** null = no upper bound applies. */
    maxReportableHours: number | null;
    remainingReportableHours: number | null;
    remote: RemoteUsage;
}

export interface DaySummary {
    date: string;
    onsiteHours: number;
    remoteHours: number;
    totalHours: number;
    sessions: SessionView[];
}

export interface EmployeeWeeklySummary extends WeekBalance {
    userId: string;
    fullName: string;
    employeeId: string | null;
    isActive: boolean;
    days: DaySummary[];
    /** Alias of verifiedHours. */
    totalHours: number;
    openSession: SessionView | null;
    incompleteCount: number;
    /** Reported more hours than attendance verifies. */
    overReported: boolean;
}

/**
 * The live state of the signed-in employee — this is what drives the
 * header timer. `session.clockInAt` is the authoritative start instant, so
 * the timer survives refreshes and re-logins: it is recomputed from the
 * server's timestamp, never counted in the browser.
 */
export interface CurrentAttendance {
    serverTime: string;
    timezone: string;
    employeeId: string | null;
    session: SessionView | null;
    lastClockOutAt: string | null;
    remote: RemoteUsage & { canClockIn: boolean; canClockOut: boolean };
}

export interface MyHistory {
    from: string;
    to: string;
    timezone: string;
    sessions: SessionView[];
    days: Array<{ date: string; onsiteHours: number; remoteHours: number; totalHours: number }>;
    onsiteHours: number;
    remoteHours: number;
    totalHours: number;
}

export interface MyHoursResult {
    weekly: EmployeeWeeklySummary;
    biweekly: { week1: EmployeeWeeklySummary; week2: EmployeeWeeklySummary };
}

export interface AttendanceSettings {
    timezone: string;
    maxSessionHours: number;
    standardWeekHours: number;
    /** Monday from which reports are capped by verified attendance. null = off. */
    enforcementStart: string | null;
    currentWeek: string;
}

export interface SessionsResult {
    from: string;
    to: string;
    timezone: string;
    sessions: SessionView[];
}

export interface AttendanceException {
    type: 'incomplete' | 'long_open' | 'long_session' | 'short_session' | string;
    message: string;
    session: SessionView;
}

export interface WeeklyFlag {
    userId: string;
    fullName: string;
    employeeId: string | null;
    weekStart: string;
    remoteExceeded: boolean;
    overReported: boolean;
    remoteActualHours: number;
    remoteLimitHours: number;
    reportedHours: number;
    verifiedHours: number;
}

export interface ExceptionsResult {
    sessions: AttendanceException[];
    weekly: WeeklyFlag[];
}

export interface CorrectionEntry {
    id: string;
    sessionId: string;
    userId: string;
    action: 'create' | 'edit' | 'close' | 'void' | 'manual_clock' | string;
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    reason: string;
    correctedBy: string | null;
    correctedByName: string;
    createdAt: string;
    employeeName: string | null;
    employeeId: string | null;
}

export interface AuditEntry {
    id: string;
    timestamp: string;
    entityType: string;
    entityId: string | null;
    action: string;
    oldValue: Record<string, unknown> | null;
    newValue: Record<string, unknown> | null;
    ipAddress: string | null;
    actorId: string | null;
    actorName: string | null;
}

export interface UserAttendanceSummary {
    userId: string;
    fullName: string;
    employeeId: string | null;
    timezone: string;
    currentSession: SessionView | null;
    allTime: { onsiteHours: number; remoteHours: number; totalHours: number; sessions: number };
    remotePolicy: RemotePolicy;
    /** Most recent week first. */
    weeks: WeekBalance[];
    recentSessions: SessionView[];
}

export interface BiweeklyResult {
    week1: EmployeeWeeklySummary[];
    week2: EmployeeWeeklySummary[];
    biweekStart: string;
}

export interface MonthlyRow {
    userId: string;
    fullName: string;
    employeeId: string | null;
    isActive: boolean;
    onsiteHours: number;
    remoteHours: number;
    totalHours: number;
    /** Distinct days with any recorded work in the month. */
    daysWorked: number;
    /** Closed sessions only. */
    sessions: number;
    incomplete: number;
}

export interface MonthlyResult {
    month: string;
    employees: MonthlyRow[];
}

export interface CsvImportResult {
    imported: number;
    skipped: number;
    duplicates: number;
    errors: string[];
}

/* ─── Employee: own attendance (read-only) ──────────────────────────── */

export const getCurrent = () =>
    api.get<CurrentAttendance>('/attendance/me/current').then((r) => r.data);

export const getMyHistory = (from?: string, to?: string) =>
    api.get<MyHistory>('/attendance/me/history', { params: { from, to } }).then((r) => r.data);

export const getMyBalance = (weekStart?: string) =>
    api.get<WeekBalance>('/attendance/me/balance', { params: { weekStart } }).then((r) => r.data);

export const getMyHours = (weekStart?: string) =>
    api.get<MyHoursResult>('/attendance/my-hours', { params: { weekStart } }).then((r) => r.data);

/* ─── Employee: portal clock (remote-authorised employees only) ─────── */

export const selfClockIn = () =>
    api.post('/attendance/me/clock-in').then((r) => r.data);

export const selfClockOut = () =>
    api.post('/attendance/me/clock-out').then((r) => r.data);

/* ─── Administrator: organisation-wide views ────────────────────────── */

export const getSettings = () =>
    api.get<AttendanceSettings>('/attendance/settings').then((r) => r.data);

export const setEnforcementStart = (enforcementStart: string | null) =>
    api.put<AttendanceSettings>('/attendance/settings/enforcement', { enforcementStart }).then((r) => r.data);

export const getWeekly = (weekStart: string) =>
    api.get<EmployeeWeeklySummary[]>('/attendance/weekly', { params: { weekStart } }).then((r) => r.data);

export const getBiweekly = (biweekStart: string) =>
    api.get<BiweeklyResult>('/attendance/biweekly', { params: { biweekStart } }).then((r) => r.data);

export const getMonthly = (month: string) =>
    api.get<MonthlyResult>('/attendance/monthly', { params: { month } }).then((r) => r.data);

export const listSessions = (q: {
    from?: string; to?: string; userId?: string; status?: string; mode?: string; search?: string;
}) => api.get<SessionsResult>('/attendance/sessions', { params: q }).then((r) => r.data);

export const getExceptions = () =>
    api.get<ExceptionsResult>('/attendance/exceptions').then((r) => r.data);

export const getCorrections = (q: { sessionId?: string; userId?: string; limit?: number } = {}) =>
    api.get<CorrectionEntry[]>('/attendance/corrections', { params: q }).then((r) => r.data);

export const getAudit = (limit = 200) =>
    api.get<AuditEntry[]>('/attendance/audit', { params: { limit } }).then((r) => r.data);

export const getUserSummary = (userId: string) =>
    api.get<UserAttendanceSummary>(`/attendance/users/${userId}/summary`).then((r) => r.data);

export const getUserBalance = (userId: string, weekStart?: string) =>
    api.get<WeekBalance>(`/attendance/users/${userId}/balance`, { params: { weekStart } }).then((r) => r.data);

/* ─── Administrator: manual entries and corrections (all audited) ───── */

export const adminClockIn = (userId: string, reason: string) =>
    api.post('/attendance/clock-in', { userId, reason }).then((r) => r.data);

export const adminClockOut = (userId: string, reason: string) =>
    api.post('/attendance/clock-out', { userId, reason }).then((r) => r.data);

export const createSession = (body: {
    userId: string; clockInAt: string; clockOutAt: string; mode?: SessionMode; reason: string;
}) => api.post<SessionView>('/attendance/sessions', body).then((r) => r.data);

export const correctSession = (id: string, body: {
    clockInAt?: string; clockOutAt?: string; mode?: SessionMode; reason: string;
}) => api.patch<SessionView>(`/attendance/sessions/${id}`, body).then((r) => r.data);

export const voidSession = (id: string, reason: string) =>
    api.post<SessionView>(`/attendance/sessions/${id}/void`, { reason }).then((r) => r.data);

export const importCsv = (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<CsvImportResult>('/attendance/import-csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
};

export const exportAttendancePdf = async (weekStart: string, type: 'weekly' | 'biweekly' = 'weekly') => {
    const res = await api.get('/attendance/export/pdf', {
        params: type === 'biweekly' ? { biweekStart: weekStart, type } : { weekStart, type },
        responseType: 'blob',
    });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${type}-${weekStart}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
};
