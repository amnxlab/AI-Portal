import { useState, useEffect, useCallback, useRef } from 'react';
import { Typography, Tooltip } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getCurrent, type CurrentAttendance } from '../api/attendance';
import { useAuthStore } from '../store/authStore';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../theme/useTheme';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The live working-time timer in the application header.

   This is a VIEW of central attendance data and nothing more. It never
   creates or modifies an attendance record: it reads the open session's
   authoritative clock-in instant from the server and counts up from it.

   Because the elapsed time is derived from that timestamp rather than
   accumulated in the browser, it survives refreshes, navigation and
   signing out and back in — and it cannot drift. The server's own clock is
   used as the reference: `serverTime` from the same response gives the
   offset between the two machines, so a browser whose clock is wrong still
   shows the right elapsed time.
   ═══════════════════════════════════════════════════════════════════════ */

const REFRESH_MS = 60_000;

/** HH:MM:SS, hours uncapped so a long session reads 13:04:09 rather than wrapping. */
function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function WorkTimer() {
    const { t } = useTheme();
    const user = useAuthStore((s) => s.user);
    const [data, setData] = useState<CurrentAttendance | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [compact, setCompact] = useState(() => window.innerWidth < 900);

    /** serverTime − browser time at the moment of the last fetch. */
    const skewRef = useRef(0);

    const load = useCallback(async () => {
        try {
            const res = await getCurrent();
            skewRef.current = Date.parse(res.serverTime) - Date.now();
            setData(res);
        } catch {
            // A failed poll must never blank the header; keep the last known
            // state and try again on the next tick.
        }
    }, []);

    useEffect(() => { if (user) void load(); }, [user, load]);

    // Content-free socket signal: the employee's own attendance changed, so
    // re-read it. This is what starts the timer the instant the reader
    // records a clock-in, without polling every second.
    useSocket({ 'attendance:changed': () => { void load(); } });

    // Safety net: a dropped socket must not leave a stale timer, and a
    // backgrounded tab should resync the moment it is looked at again.
    useEffect(() => {
        if (!user) return;
        const id = setInterval(() => { void load(); }, REFRESH_MS);
        const onFocus = () => { if (document.visibilityState === 'visible') void load(); };
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', onFocus);
            window.removeEventListener('focus', onFocus);
        };
    }, [user, load]);

    useEffect(() => {
        const onResize = () => setCompact(window.innerWidth < 900);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // The one-second tick. Only runs while a session is actually open.
    const startedAt = data?.session?.clockInAt ?? null;
    useEffect(() => {
        if (!startedAt) { setElapsed(0); return; }
        const started = Date.parse(startedAt);
        const tick = () => setElapsed(Date.now() + skewRef.current - started);
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [startedAt]);

    if (!user) return null;

    const session = data?.session ?? null;
    const active = !!session;
    const employeeId = data?.employeeId ?? null;

    const tip = active
        ? `Clocked in at ${dayjs(session!.clockInAt).format('HH:mm')} on ${dayjs(session!.clockInAt).format('ddd D MMM')}`
            + ` · ${session!.mode === 'remote' ? 'Remote' : 'On-site'}`
            + ` · recorded by ${session!.source === 'rfid' ? 'the RFID reader' : 'the portal'}`
        : data?.lastClockOutAt
            ? `Not clocked in. Last clock-out ${dayjs(data.lastClockOutAt).format('ddd D MMM, HH:mm')}`
            : 'Not clocked in.';

    return (
        <Tooltip title={tip} placement="bottom">
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 999,
                    background: active ? t.successBg : t.surfaceRaised,
                    border: `1px solid ${active ? t.successBorder : t.borderSubtle}`,
                    flexShrink: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                }}
            >
                {/* Active/inactive status dot */}
                <span
                    aria-hidden
                    style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: active ? t.success : t.textFaint,
                        boxShadow: active ? `0 0 0 3px ${t.successBg}` : 'none',
                        flexShrink: 0,
                    }}
                />

                {active ? (
                    <Text
                        style={{
                            color: t.success,
                            fontSize: 13,
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            letterSpacing: '0.3px',
                            lineHeight: '28px',
                        }}
                        aria-live="off"
                        aria-label={`Working time ${formatElapsed(elapsed)}`}
                    >
                        {formatElapsed(elapsed)}
                    </Text>
                ) : (
                    <>
                        <ClockCircleOutlined style={{ color: t.textFaint, fontSize: 12 }} />
                        <Text style={{ color: t.textMuted, fontSize: 12, lineHeight: '28px' }}>
                            Not clocked in
                        </Text>
                    </>
                )}

                {/* Employee name and ID, beside the timer. Dropped on narrow
                    screens, where the avatar menu already carries the name. */}
                {!compact && (
                    <>
                        <span style={{ width: 1, height: 14, background: t.borderSubtle, flexShrink: 0 }} />
                        <Text
                            style={{
                                color: t.text, fontSize: 12, fontWeight: 600, lineHeight: '28px',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160,
                            }}
                        >
                            {user.fullName}
                        </Text>
                        {employeeId && (
                            <Text
                                style={{
                                    color: t.textMuted, fontSize: 11, lineHeight: '28px',
                                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                                }}
                            >
                                {employeeId}
                            </Text>
                        )}
                    </>
                )}
            </div>
        </Tooltip>
    );
}
