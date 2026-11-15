import { useEffect, useState, useCallback } from 'react';
import {
    Button, Card, Checkbox, Input, InputNumber, Select, Space, Table, Typography,
    Alert, Spin, Row, Col, Tag, DatePicker, Tooltip, Popconfirm,
    Form, Modal, Badge, Divider,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    PlayCircleOutlined, ExperimentOutlined, DeleteOutlined, UserOutlined,
    PlusOutlined, CalendarOutlined, ClockCircleOutlined, DollarOutlined,
    InfoCircleOutlined, PrinterOutlined, SaveOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import {
    BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip as RTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import { getSustainability, getSimulationSnapshots, saveSimulationSnapshot, deleteSimulationSnapshot } from '../../../api/budget';
import api from '../../../api/axios';
import { alpha } from '../../../theme/tokens';
import { useTheme } from '../../../theme/useTheme';
import { FormModal } from '../../../components/ui';

const { Text, Title } = Typography;

const fmt = (n: number | null | undefined) =>
    `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtHrs = (h: number) => `${h.toFixed(1)} h`;

/* ─── Data model ─────────────────────────────────────────────────────────── */
interface WorkPeriod {
    periodId: string;
    startDate: string | null;   // null = simulation start
    endDate: string | null;   // null = runs to sim end
    hourlyRate: number;
    weeklyHours: number;
}

interface SimMember {
    simId: string;
    userId?: string;
    name: string;
    defaultRate: number;
    defaultHours: number;
    included: boolean;
    periods: WorkPeriod[];
}

interface TimelinePoint {
    label: string;
    burn: number;
    balance: number;
    hours: number;
    active: number;
}

interface EmpResult {
    simId: string; name: string;
    totalBurn: number; totalHours: number; activeDays: number;
}

interface SimResult {
    timeline: TimelinePoint[];
    perEmployee: EmpResult[];
    avgBurn: number;
    peakBurn: number;
    peakBurnLabel: string;
    avgHours: number;
    peakHours: number;
    runwayMonths: number | null;
    exhaustionDate: string | null;
}

interface UserOption {
    id: string; fullName: string; isActive?: boolean;
    hourlyRate?: number | null; weeklyHoursCap?: number | null;
}

interface SimSnapshot {
    id: string;
    name: string;
    savedAt: string;   // ISO timestamp (createdAt from API)
    laborBalance: number;
    simMonths: number;
    simStartIso: string;   // YYYY-MM-DD
    members: SimMember[];
}

let _id = 1;
const uid = () => `s${_id++}`;

/* ─── Simulation engine ─ period-direct, day-granular attribution ────────── *
 * Algorithm (three passes):                                                *
 *                                                                          *
 * Pass 0 — Pre-populate every calendar-month bucket in [simStart, simEnd) *
 *   with burn=0. This guarantees inactive months appear in the timeline   *
 *   with a flat balance line rather than being silently omitted.          *
 *                                                                          *
 * Pass 1 — For each included member, for each of their periods:           *
 *   • Resolve startDate (null → simStart) and endDate (null → simEnd).    *
 *   • endDate is INCLUSIVE: add 1 day to convert to exclusive upper bound.*
 *   • Clamp to simulation bounds; skip if resulting range is empty.       *
 *   • Iterate day-by-day and accumulate dayBurn = rate × weeklyHours / 7  *
 *     into the correct pre-populated month bucket.                        *
 *   This approach processes every day in every period exactly once,       *
 *   eliminating dropped days at period transitions.                       *
 *                                                                          *
 * Pass 2 — Walk ALL month buckets in chronological order, deduct burn     *
 *   from the running balance, and stop once the balance hits zero.        *
 ***************************************************************************/
function runSim(members: SimMember[], balance: number, months: number, start: Dayjs): SimResult {
    const simEnd = start.add(months, 'month');

    type MonthBucket = { label: string; monthStart: Dayjs; burn: number; hours: number; activeIds: Set<string>; dayBurns: number[] };
    const buckets = new Map<string, MonthBucket>();
    const empTotals = new Map<string, EmpResult>();

    // --- Pass 0: pre-populate all calendar-month buckets so every month
    //   appears in the timeline even when no employee is active that month.
    let cursor = start.startOf('month');
    while (cursor.isBefore(simEnd)) {
        const key = cursor.format('YYYY-MM');
        buckets.set(key, {
            label: cursor.format('MMM YYYY'),
            monthStart: cursor,
            burn: 0,
            hours: 0,
            activeIds: new Set(),
            dayBurns: new Array(cursor.daysInMonth()).fill(0),
        });
        cursor = cursor.add(1, 'month');
    }

    // --- Pass 1: for each member × each period, iterate day-by-day and
    //   accumulate into the correct pre-populated month bucket.
    for (const m of members) {
        if (!m.included || m.periods.length === 0) continue;  // explicit-only: no periods = no burn

        for (const period of m.periods) {
            // Resolve period boundaries; endDate is user-visible INCLUSIVE date,
            // so add 1 day to turn it into an exclusive upper bound for iteration.
            const periodStart = period.startDate ? dayjs(period.startDate) : start;
            const periodEnd   = period.endDate   ? dayjs(period.endDate).add(1, 'day') : simEnd;

            // Clamp to simulation window
            const effStart = periodStart.isBefore(start)  ? start  : periodStart;
            const effEnd   = periodEnd.isAfter(simEnd)     ? simEnd : periodEnd;

            if (!effStart.isBefore(effEnd)) continue; // empty range — skip

            const dayBurn  = period.hourlyRate * period.weeklyHours / 7;
            const dayHours = period.weeklyHours / 7;

            let day = effStart;
            while (day.isBefore(effEnd)) {
                const key = day.format('YYYY-MM');
                const b = buckets.get(key);
                if (b) {
                    b.burn  += dayBurn;
                    b.hours += dayHours;
                    b.activeIds.add(m.simId);
                    b.dayBurns[day.date() - 1] += dayBurn;
                }

                // Per-employee totals
                if (!empTotals.has(m.simId)) {
                    empTotals.set(m.simId, { simId: m.simId, name: m.name, totalBurn: 0, totalHours: 0, activeDays: 0 });
                }
                const et = empTotals.get(m.simId)!;
                et.totalBurn   += dayBurn;
                et.totalHours  += dayHours;
                et.activeDays  += 1;

                day = day.add(1, 'day');
            }
        }
    }

    // --- Pass 2: deduct month by month, build timeline ----------------------
    const timeline: TimelinePoint[] = [];
    let remaining = balance;
    let exhaustionDate: string | null = null;

    for (const [, b] of buckets) {
        const prevRemaining = remaining;
        remaining = Math.round((remaining - b.burn) * 100) / 100;
        if (remaining <= 0 && !exhaustionDate) {
            // Find the exact day within this month when the balance hits zero
            let dayBalance = prevRemaining;
            let foundDay = b.monthStart;
            for (let d = 0; d < b.dayBurns.length; d++) {
                dayBalance -= b.dayBurns[d];
                if (dayBalance <= 0) {
                    foundDay = b.monthStart.date(d + 1);
                    break;
                }
            }
            exhaustionDate = foundDay.format('YYYY-MM-DD');
        }
        timeline.push({
            label: b.label,
            burn: Math.round(b.burn * 100) / 100,
            balance: Math.max(0, Math.round(remaining * 100) / 100),
            hours: Math.round(b.hours * 10) / 10,
            active: b.activeIds.size,
        });
        if (remaining <= 0) break;
    }

    // --- Derived stats -------------------------------------------------------
    const burns  = timeline.map(t => t.burn).filter(b => b > 0);
    const hrArr  = timeline.map(t => t.hours).filter(h => h > 0);
    const avgBurn = burns.length  ? burns.reduce((a, b) => a + b, 0) / burns.length  : 0;
    const peakBurn = burns.length ? Math.max(...burns) : 0;
    const peakBurnLabel = timeline.find(t => t.burn === peakBurn)?.label ?? '—';
    const avgHours  = hrArr.length  ? hrArr.reduce((a, b) => a + b, 0) / hrArr.length  : 0;
    const peakHours = hrArr.length  ? Math.max(...hrArr) : 0;
    const exhaustIdx = timeline.findIndex(t => t.balance <= 0);

    const perEmployee = [...empTotals.values()].sort((a, b) => b.totalBurn - a.totalBurn);

    return {
        timeline,
        perEmployee,
        avgBurn, peakBurn, peakBurnLabel, avgHours, peakHours,
        runwayMonths: exhaustIdx < 0 ? null : exhaustIdx + 1,
        exhaustionDate,
    };
}

/* ─── Format period dates for display ───────────────────────────────────── */
const pdLabel = (p: WorkPeriod) => {
    const s = p.startDate ? dayjs(p.startDate).format('MMM YYYY') : 'Sim start';
    const e = p.endDate ? dayjs(p.endDate).format('MMM YYYY') : 'Sim end';
    return `${s} → ${e}`;
};

/* ════════════════════════════════════════════════════════════════════════════
   Component
═══════════════════════════════════════════════════════════════════════════ */
export default function SimulationTab() {
    const { t } = useTheme();
    const card = { background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 8 };
    const [users, setUsers] = useState<UserOption[]>([]);
    const [members, setMembers] = useState<SimMember[]>([]);
    const [laborBalance, setLaborBalance] = useState<number>(0);
    const [simMonths, setSimMonths] = useState<number>(24);
    const [simStart, setSimStart] = useState<Dayjs>(dayjs().startOf('month'));
    const [result, setResult] = useState<SimResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // modal state
    const [addMemberOpen, setAddMemberOpen] = useState(false);
    const [addMemberForm] = Form.useForm();
    const [addPeriodOpen, setAddPeriodOpen] = useState<string | null>(null); // simId
    const [addPeriodForm] = Form.useForm();

    // expanded rows
    const [expandedRows, setExpandedRows] = useState<string[]>([]);

    // saved scenarios
    const [savedSims, setSavedSims] = useState<SimSnapshot[]>([]);
    const [snapsLoading, setSnapsLoading] = useState(false);
    const [saveModalOpen, setSaveModalOpen] = useState(false);
    const [saveName, setSaveName] = useState('');

    /* ── init ─────────────────────────────────────────────────────────── */
    const loadInit = useCallback(async () => {
        try {
            const [ur, sus] = await Promise.all([
                api.get<UserOption[]>('/users'),
                getSustainability(),
            ]);
            const active = ur.data.filter(u => u.isActive !== false);
            setUsers(active);

            const seeded: SimMember[] = active
                .map(u => ({
                    simId: uid(),
                    userId: u.id,
                    name: u.fullName ?? '—',
                    defaultRate: Number(u.hourlyRate ?? 15),
                    defaultHours: Number(u.weeklyHoursCap ?? 0),
                    included: true,
                    periods: [],   // explicit-only: no default — add a period to start burning
                }));
            setMembers(seeded);
            setLaborBalance(sus.pools[0]?.balance ?? 0);
        } catch {
            setError('Failed to load users — check your connection.');
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshSnapshots = useCallback(async () => {
        setSnapsLoading(true);
        try {
            const snaps = await getSimulationSnapshots();
            setSavedSims(snaps.map(s => ({
                id: s.id,
                name: s.name,
                savedAt: s.createdAt,
                laborBalance: Number(s.laborBalance),
                simMonths: s.simMonths,
                simStartIso: s.simStartIso,
                members: s.members as SimMember[],
            })));
        } catch {
            // non-fatal — saved scenarios panel just stays empty
        } finally {
            setSnapsLoading(false);
        }
    }, []);

    useEffect(() => { loadInit(); refreshSnapshots(); }, [loadInit, refreshSnapshots]);

    /* ── member helpers ───────────────────────────────────────────────── */
    const toggleMember = (simId: string, included: boolean) =>
        setMembers(p => p.map(m => m.simId === simId ? { ...m, included } : m));

    const removeMember = (simId: string) =>
        setMembers(p => p.filter(m => m.simId !== simId));

    const addPeriod = (simId: string) => {
        addPeriodForm.resetFields();
        addPeriodForm.setFieldsValue({
            hourlyRate: members.find(m => m.simId === simId)?.defaultRate ?? 15,
            weeklyHours: members.find(m => m.simId === simId)?.defaultHours ?? 0,
        });
        setAddPeriodOpen(simId);
    };

    const confirmAddPeriod = async () => {
        try {
            const vals = await addPeriodForm.validateFields();
            setMembers(p => p.map(m => m.simId === addPeriodOpen ? {
                ...m,
                periods: [...m.periods, {
                    periodId: uid(),
                    startDate: vals.startDate ? vals.startDate.format('YYYY-MM-DD') : null,
                    endDate: vals.endDate ? vals.endDate.format('YYYY-MM-DD') : null,
                    hourlyRate: vals.hourlyRate,
                    weeklyHours: vals.weeklyHours,
                }],
            } : m));
            setAddPeriodOpen(null);
        } catch {
            // Field validation failed — antd's Form already renders the inline
            // errors; nothing else to do, but don't leave an unhandled rejection.
        }
    };

    const removePeriod = (simId: string, periodId: string) =>
        setMembers(p => p.map(m => m.simId === simId
            ? { ...m, periods: m.periods.filter(pp => pp.periodId !== periodId) }
            : m
        ));

    const updatePeriod = (simId: string, periodId: string, patch: Partial<WorkPeriod>) =>
        setMembers(p => p.map(m => m.simId === simId
            ? { ...m, periods: m.periods.map(pp => pp.periodId === periodId ? { ...pp, ...patch } : pp) }
            : m
        ));

    const handleAddMember = async () => {
        try {
            const vals = await addMemberForm.validateFields();
            const user = vals.userId ? users.find(u => u.id === vals.userId) : null;
            const rate = Number(vals.hourlyRate ?? user?.hourlyRate ?? 15);
            const hours = Number(vals.weeklyHours ?? user?.weeklyHoursCap ?? 0);
            setMembers(p => [...p, {
                simId: uid(),
                userId: user?.id,
                name: user ? user.fullName : (vals.customName || 'Custom employee'),
                defaultRate: rate,
                defaultHours: hours,
                included: true,
                periods: [{
                    periodId: uid(),
                    startDate: null,
                    endDate: null,
                    hourlyRate: rate,
                    weeklyHours: hours,
                }],
            }]);
            addMemberForm.resetFields();
            setAddMemberOpen(false);
        } catch {
            // Field validation failed — antd's Form already renders the inline
            // errors; nothing else to do, but don't leave an unhandled rejection.
        }
    };

    /* ── run ──────────────────────────────────────────────────────────── */
    const handleRun = () => setResult(runSim(members, laborBalance, simMonths, simStart));

    /* ── Save / Load / Delete scenarios (persisted in DB) ──────────── */
    const saveScenario = async () => {
        const name = saveName.trim() || `Scenario ${new Date().toLocaleDateString()}`;
        try {
            await saveSimulationSnapshot({
                name,
                laborBalance,
                simMonths,
                simStartIso: simStart.format('YYYY-MM-DD'),
                members: JSON.parse(JSON.stringify(members)),
            });
            setSaveModalOpen(false);
            setSaveName('');
            await refreshSnapshots();
        } catch {
            setError('Failed to save scenario — please try again.');
        }
    };

    const loadScenario = (snap: SimSnapshot) => {
        setLaborBalance(snap.laborBalance);
        setSimMonths(snap.simMonths);
        setSimStart(dayjs(snap.simStartIso).startOf('month'));
        setMembers(snap.members);
        setResult(null);
        setExpandedRows([]);
    };

    const deleteScenario = async (id: string) => {
        try {
            await deleteSimulationSnapshot(id);
            setSavedSims(prev => prev.filter(s => s.id !== id));
        } catch {
            setError('Failed to delete scenario — please try again.');
        }
    };

    /* ── Print report ─────────────────────────────────────────────────── */
    const printReport = () => {
        if (!result) return;
        const now = dayjs().format('MMMM D, YYYY HH:mm');
        const rows = result.timeline.map(t => `
            <tr>
                <td>${t.label}</td>
                <td>${t.active}</td>
                <td class="num">${t.hours.toFixed(1)} h</td>
                <td class="num red">$${t.burn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="num">${t.balance <= 0 ? '<span class="exhausted">EXHAUSTED</span>' : '$' + t.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>`).join('');

        const empRows = members.filter(m => m.included).map(m => {
            const periodRows = m.periods.map(p => `
                <tr class="period-row">
                    <td></td>
                    <td class="period-label">
                        ${p.startDate ? dayjs(p.startDate).format('MMM D, YYYY') : 'Sim start'}
                        &rarr;
                        ${p.endDate ? dayjs(p.endDate).format('MMM D, YYYY') : 'Sim end'}
                    </td>
                    <td>$${Number(p.hourlyRate).toFixed(2)}/hr</td>
                    <td>${p.weeklyHours} h/wk</td>
                    <td class="num">$${(p.hourlyRate * p.weeklyHours * 4.33).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo (est.)</td>
                </tr>`).join('');
            return `<tr><td><strong>${m.name}</strong></td><td colspan="4">${m.periods.length} period(s)</td></tr>${periodRows}`;
        }).join('');

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Payroll Simulation Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: rgb(17,17,17); background: t.textOnAccent; padding: 32px 40px; font-size: 13px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
  .subtitle { color: rgb(85,85,85); font-size: 12px; margin-bottom: 24px; }
  h2 { font-size: 14px; font-weight: 700; margin: 24px 0 8px; border-bottom: 2px solid t.text; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th { background: rgb(17,17,17); color: t.textOnAccent; padding: 6px 10px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 5px 10px; border-bottom: 1px solid rgb(224,224,224); vertical-align: top; }
  tr:nth-child(even) td { background: rgb(248,248,248); }
  .num { text-align: right; font-family: monospace; }
  .red { color: rgb(204,0,0); font-weight: 600; }
  .exhausted { color: rgb(204,0,0); font-weight: 700; }
  .period-row td { background: rgb(243,246,255); font-size: 12px; }
  .period-label { color: rgb(51,51,51); font-style: italic; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 8px; }
  .kpi { border: 1px solid rgb(221,221,221); border-radius: 6px; padding: 12px 14px; }
  .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: rgb(85,85,85); margin-bottom: 4px; }
  .kpi-value { font-size: 20px; font-weight: 700; }
  .kpi-sub { font-size: 10px; color: rgb(119,119,119); margin-top: 2px; }
  .params { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
  .param { padding: 8px 10px; border: 1px solid rgb(221,221,221); border-radius: 4px; }
  .param-label { font-size: 10px; color: rgb(102,102,102); text-transform: uppercase; }
  .param-value { font-size: 14px; font-weight: 600; }
  @media print {
    body { padding: 16px 20px; }
    .no-break { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>Payroll Simulation Report</h1>
  <div class="subtitle">Generated: ${now}</div>

  <h2>Simulation Parameters</h2>
  <div class="params">
    <div class="param"><div class="param-label">Labor Balance</div><div class="param-value">$${laborBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div></div>
    <div class="param"><div class="param-label">Simulation Start</div><div class="param-value">${simStart.format('MMMM YYYY')}</div></div>
    <div class="param"><div class="param-label">Duration</div><div class="param-value">${simMonths} months</div></div>
  </div>

  <h2>Key Results</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Avg Burn / Month</div><div class="kpi-value" style="color:${t.danger}">$${result.avgBurn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="kpi-sub">Peak: $${result.peakBurn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${result.peakBurnLabel})</div></div>
    <div class="kpi"><div class="kpi-label">Avg Hours / Month</div><div class="kpi-value" style="color:${t.success}">${result.avgHours.toFixed(1)} h</div><div class="kpi-sub">Peak: ${result.peakHours.toFixed(1)} h</div></div>
    <div class="kpi"><div class="kpi-label">Runway</div><div class="kpi-value" style="color:${result.runwayMonths !== null && result.runwayMonths < 6 ? t.danger : t.success}">${result.runwayMonths === null ? '∞' : result.runwayMonths + ' months'}</div><div class="kpi-sub">${result.timeline.length} months modeled</div></div>
    <div class="kpi"><div class="kpi-label">Exhaustion Date</div><div class="kpi-value" style="color:${result.exhaustionDate ? t.danger : t.success}">${result.exhaustionDate ? dayjs(result.exhaustionDate).format('MMM YYYY') : '—'}</div><div class="kpi-sub">${result.exhaustionDate ? 'Funds run out' : '✓ Sustainable'}</div></div>
  </div>

  <h2>Simulation Payroll Pool</h2>
  <table>
    <thead><tr><th>Employee</th><th>Period</th><th>Rate</th><th>Hours</th><th>Est. Monthly Cost</th></tr></thead>
    <tbody>${empRows}</tbody>
  </table>

  <h2>Monthly Timeline</h2>
  <table class="no-break">
    <thead><tr><th>Month</th><th>Active Employees</th><th class="num">Team Hours</th><th class="num">Burn</th><th class="num">Remaining Balance</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;

        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) return;
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 600);
    };

    /* ── period sub-table ─────────────────────────────────────────────── */
    const periodColumns = (simId: string): ColumnsType<WorkPeriod> => [
        {
            title: 'Period', key: 'label', width: 200,
            render: (_: any, p: WorkPeriod) => (
                <Tag color="blue" style={{ fontSize: 11, fontFamily: 'monospace' }}>{pdLabel(p)}</Tag>
            ),
        },
        {
            title: 'Active From', key: 'start', width: 150,
            render: (_: any, p: WorkPeriod) => (
                <DatePicker
                    size="small" 
                    value={p.startDate ? dayjs(p.startDate) : null}
                    placeholder="Sim start"
                    onChange={d => updatePeriod(simId, p.periodId, { startDate: d ? d.format('YYYY-MM-DD') : null })}
                    allowClear
                />
            ),
        },
        {
            title: 'Until', key: 'end', width: 150,
            render: (_: any, p: WorkPeriod) => (
                <DatePicker
                    size="small" 
                    value={p.endDate ? dayjs(p.endDate) : null}
                    placeholder="Sim end"
                    onChange={d => updatePeriod(simId, p.periodId, { endDate: d ? d.format('YYYY-MM-DD') : null })}
                    allowClear
                />
            ),
        },
        {
            title: '$/hr', key: 'rate', width: 100,
            render: (_: any, p: WorkPeriod) => (
                <InputNumber
                    size="small" min={0} precision={2} value={p.hourlyRate} 
                    onChange={v => updatePeriod(simId, p.periodId, { hourlyRate: v ?? 0 })}
                    prefix="$"
                />
            ),
        },
        {
            title: 'Hrs/wk', key: 'hrs', width: 90,
            render: (_: any, p: WorkPeriod) => (
                <InputNumber
                    size="small" min={0} max={168} value={p.weeklyHours} 
                    onChange={v => updatePeriod(simId, p.periodId, { weeklyHours: v ?? 0 })}
                />
            ),
        },
        {
            title: '$/mo', key: 'mo', width: 100,
            render: (_: any, p: WorkPeriod) => (
                <Text style={{ color: t.danger, fontSize: 12, fontWeight: 600 }}>
                    {fmt(p.hourlyRate * p.weeklyHours * 4.33)}
                </Text>
            ),
        },
        {
            title: '', key: 'rm', width: 36,
            render: (_: any, p: WorkPeriod) => (
                <Tooltip title="Remove this period">
                    <Popconfirm
                        title="Remove this work period?"
                        onConfirm={() => removePeriod(simId, p.periodId)}
                        okText="Remove" okButtonProps={{ danger: true }}
                    >
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Tooltip>
            ),
        },
    ];

    /* ── main member columns ──────────────────────────────────────────── */
    const memberColumns: ColumnsType<SimMember> = [
        {
            title: '', key: 'inc', width: 40,
            render: (_: any, r: SimMember) => (
                <Checkbox
                    checked={r.included}
                    onChange={e => toggleMember(r.simId, e.target.checked)}
                />
            ),
        },
        {
            title: 'Employee', key: 'name',
            render: (_: any, r: SimMember) => (
                <Space>
                    <UserOutlined style={{ color: r.included ? t.accent : t.textMuted }} />
                    <Text style={{ color: r.included ? t.text : t.textMuted, fontWeight: 500 }}>{r.name}</Text>
                    {!r.included && <Tag color="default" style={{ fontSize: 10 }}>Excluded</Tag>}
                    {r.included && r.periods.some(p => !p.endDate) && (
                        <Tooltip title="Has an open-ended period — active through entire simulation. Set an 'Until' date to limit their burn window.">
                            <Tag color="orange" style={{ fontSize: 10, cursor: 'help' }}>Open-ended</Tag>
                        </Tooltip>
                    )}
                </Space>
            ),
        },
        {
            title: 'Periods', key: 'periods', width: 90, align: 'center',
            render: (_: any, r: SimMember) => (
                <Badge count={r.periods.length} color={t.accent} style={{ fontSize: 11 }}>
                    <CalendarOutlined style={{ color: t.textMuted, fontSize: 14 }} />
                </Badge>
            ),
        },
        {
            title: 'Avg $/mo (est.)', key: 'base', width: 140, align: 'right',
            render: (_: any, r: SimMember) => {
                const base = r.periods.reduce((best, p) =>
                    !p.startDate && !p.endDate ? p : best, r.periods[0]);
                // 365/12/7 ≈ 4.345 — the long-run average weeks per calendar month
                return (
                    <Tooltip title="Based on the open-ended period's rate × hours × 4.345 (avg weeks/month). Actual monthly burn varies by days in month and active periods.">
                        <Text style={{ color: t.danger, fontSize: 12 }}>{base ? fmt(base.hourlyRate * base.weeklyHours * (365 / 12 / 7)) : '—'}</Text>
                    </Tooltip>
                );
            },
        },
        {
            title: '', key: 'actions', width: 120, align: 'right',
            render: (_: any, r: SimMember) => (
                <Space size={4}>
                    <Tooltip title="Add work period">
                        <Button size="small" icon={<PlusOutlined />} onClick={e => { e.stopPropagation(); addPeriod(r.simId); }}>
                            Period
                        </Button>
                    </Tooltip>
                    <Popconfirm title="Remove from simulation?" onConfirm={() => removeMember(r.simId)} okText="Remove" okButtonProps={{ danger: true }}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const runwayColor = !result ? t.textMuted
        : result.runwayMonths === null ? t.success
            : result.runwayMonths < 3 ? t.danger
                : result.runwayMonths < 6 ? t.warning : t.success;

    if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;

    /* ─────────────────────────────────────────────────────────────────── */
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
                <Alert type="error" message={error} closable onClose={() => setError('')} />
            )}

            {/* ── SAVED SCENARIOS PANEL ───────────────────────────────── */}
            {(snapsLoading || savedSims.length > 0) && (
                <Card
                    size="small"
                    style={{ ...card, marginBottom: 0 }}
                    title={
                        <Space>
                            <FolderOpenOutlined style={{ color: t.accent }} />
                            <Text style={{ color: t.text, fontSize: 13 }}>Saved Scenarios</Text>
                            {!snapsLoading && <Tag color="blue" style={{ fontSize: 10 }}>{savedSims.length}</Tag>}
                        </Space>
                    }
                >
                    {snapsLoading ? (
                        <div style={{ textAlign: 'center', padding: '16px 0' }}><Spin size="small" /></div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            {savedSims.map(s => (
                                <div key={s.id} style={{
                                    background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 8,
                                    padding: '10px 14px', minWidth: 200, maxWidth: 260, flex: '0 0 auto',
                                }}>
                                    <Text style={{ color: t.text, fontWeight: 600, display: 'block', marginBottom: 2 }}>
                                        {s.name}
                                    </Text>
                                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                                        {dayjs(s.savedAt).format('MMM D, YYYY HH:mm')}
                                    </Text>
                                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginBottom: 8 }}>
                                        ${s.laborBalance.toLocaleString()} · {s.simMonths} mo · {s.members.filter(m => m.included).length} employees
                                    </Text>
                                    <Space size={6}>
                                        <Button
                                            size="small" type="primary" icon={<PlayCircleOutlined />}
                                            onClick={() => loadScenario(s)}
                                        >
                                            Load
                                        </Button>
                                        <Popconfirm
                                            title="Delete this scenario?"
                                            onConfirm={() => deleteScenario(s.id)}
                                            okText="Delete" okButtonProps={{ danger: true }}
                                        >
                                            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
                                        </Popconfirm>
                                    </Space>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {/* ── HEADER ─────────────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <Title level={5} style={{ color: t.text, margin: 0 }}>
                        <ExperimentOutlined style={{ marginRight: 8, color: t.purple }} />
                        Payroll Simulation
                    </Title>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        Add multiple work periods per employee to model seasonal schedules. Click a row to expand periods.
                    </Text>
                </div>
                <Button
                    type="primary" icon={<PlusOutlined />}
                    onClick={() => { addMemberForm.resetFields(); setAddMemberOpen(true); }}
                >
                    Add Employee
                </Button>
            </div>

            {/* ── EMPLOYEE TABLE ─────────────────────────────────────── */}
            <Card size="small" style={card}>
                <Table<SimMember>
                    dataSource={members}
                    columns={memberColumns}
                    rowKey="simId"
                    size="small"
                    pagination={false}
                    expandable={{
                        expandedRowKeys: expandedRows,
                        onExpand: (expanded, r) =>
                            setExpandedRows(expanded
                                ? [...expandedRows, r.simId]
                                : expandedRows.filter(k => k !== r.simId)
                            ),
                        expandedRowRender: (r: SimMember) => (
                            <div style={{ padding: '8px 8px 4px', background: t.surface, borderRadius: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <Text style={{ color: t.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                                        Work Periods — {r.name}
                                    </Text>
                                    <Button
                                        size="small" type="dashed" icon={<PlusOutlined />}
                                        onClick={() => addPeriod(r.simId)}
                                    >
                                        Add period
                                    </Button>
                                </div>
                                <Table<WorkPeriod>
                                    dataSource={r.periods}
                                    columns={periodColumns(r.simId)}
                                    rowKey="periodId"
                                    size="small"
                                    pagination={false}
                                    style={{ background: t.surface }}
                                />
                                {r.periods.length === 0 && (
                                    <div style={{ marginTop: 8, background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 6, padding: '10px 14px' }}>
                                        <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                            📅 No periods configured — <strong style={{ color: t.text }}>$0 burn</strong> in simulation.
                                            Click <strong style={{ color: t.text }}>+ Add period</strong> above to define when this employee is active.
                                        </Text>
                                    </div>
                                )}
                                {r.periods.some(p => p.endDate === null) && (
                                    <div style={{ marginTop: 8, background: alpha(t.warning, 0.1), border: `1px solid ${alpha(t.warning, 0.4)}`, borderRadius: 6, padding: '7px 12px' }}>
                                        <Text style={{ color: t.warning, fontSize: 12 }}>
                                            ⚠️ This employee has an open-ended period (no "Until" date set). They will be active — and generate burn — for every month through the end of the simulation.
                                            Set an "Until" date or delete this period to limit their active window.
                                        </Text>
                                    </div>
                                )}
                                {r.periods.length > 1 && r.periods.some(p => p.endDate !== null) && (
                                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 6 }}>
                                        <InfoCircleOutlined style={{ marginRight: 4 }} />
                                        Gap months (not covered by any period) have zero burn for this employee.
                                    </Text>
                                )}
                            </div>
                        ),
                        rowExpandable: () => true,
                    }}
                    rowClassName={r => !r.included ? 'sim-excluded' : ''}
                    onRow={r => ({
                        onClick: () => setExpandedRows(
                            expandedRows.includes(r.simId)
                                ? expandedRows.filter(k => k !== r.simId)
                                : [...expandedRows, r.simId]
                        )
                    })}
                    style={{ cursor: 'pointer' }}
                    locale={{ emptyText: 'No employees added. Click "Add Employee" to start planning.' }}
                />
                <style>{`.sim-excluded td { opacity: 0.4; }`}</style>
            </Card>

            {/* ── SIM CONFIG + RUN ────────────────────────────────────── */}
            <Card size="small" style={card} title={
                <Text style={{ color: t.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Simulation Parameters</Text>
            }>
                <Space wrap size={20}>
                    <Space direction="vertical" size={2}>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>Labor Balance</Text>
                        <InputNumber
                            min={0} precision={2} prefix="$" value={laborBalance}
                            
                            onChange={v => setLaborBalance(v ?? 0)}
                        />
                    </Space>
                    <Space direction="vertical" size={2}>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>Simulation Start</Text>
                        <DatePicker
                            picker="month" value={simStart} format="MMM YYYY"
                            
                            onChange={d => d && setSimStart(d.startOf('month'))}
                        />
                    </Space>
                    <Space direction="vertical" size={2}>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>Duration</Text>
                        <Select
                            value={simMonths} onChange={setSimMonths} 
                            options={[12, 18, 24, 36, 48, 60].map(n => ({ value: n, label: `${n} months` }))}
                        />
                    </Space>
                    <Space direction="vertical" size={2}>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>&nbsp;</Text>
                        <Button
                            type="primary" size="large" icon={<PlayCircleOutlined />}
                            onClick={handleRun}
                            disabled={members.filter(m => m.included && m.periods.length > 0).length === 0}
                        >
                            Run Simulation
                        </Button>
                    </Space>
                    <Space direction="vertical" size={2}>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>&nbsp;</Text>
                        <Button
                            icon={<SaveOutlined />} size="large"
                            onClick={() => { setSaveName(''); setSaveModalOpen(true); }}
                        >
                            Save Scenario
                        </Button>
                    </Space>
                </Space>
            </Card>

            {/* ── RESULTS ─────────────────────────────────────────────── */}
            {result && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
                        <Divider style={{ borderColor: t.border, flex: 1, margin: 0 }} />
                        <Text style={{ color: t.textMuted, fontSize: 12, whiteSpace: 'nowrap' }}>Simulation Results</Text>
                        <Button
                            icon={<PrinterOutlined />}
                            size="small"
                            onClick={printReport}
                        >
                            Print Report
                        </Button>
                        <Divider style={{ borderColor: t.border, flex: 1, margin: 0 }} />
                    </div>

                    {/* KPI row */}
                    <Row gutter={[12, 12]}>
                        {[
                            {
                                icon: <DollarOutlined />, color: t.danger,
                                title: 'Avg Burn / Month', suffix: '',
                                value: fmt(result.avgBurn),
                                sub: `Peak: ${fmt(result.peakBurn)} (${result.peakBurnLabel})`,
                            },
                            {
                                icon: <ClockCircleOutlined />, color: t.accent,
                                title: 'Avg Hours / Month', suffix: 'h',
                                value: fmtHrs(result.avgHours),
                                sub: `Peak: ${fmtHrs(result.peakHours)}`,
                            },
                            {
                                icon: <CalendarOutlined />, color: runwayColor,
                                title: 'Runway',
                                value: result.runwayMonths === null ? '∞' : `${result.runwayMonths} mo`,
                                sub: result.runwayMonths === null ? 'Funds last full simulation' : `${result.timeline.length} months modeled`,
                            },
                            {
                                icon: <ExperimentOutlined />, color: result.exhaustionDate ? t.danger : t.success,
                                title: 'Exhaustion',
                                value: result.exhaustionDate ? dayjs(result.exhaustionDate).format('MMM D, YYYY') : '—',
                                sub: result.exhaustionDate ? 'Funds run out' : '✓ Sustainable',
                            },
                        ].map((kpi, i) => (
                            <Col xs={12} sm={6} key={i}>
                                <Card size="small" style={{ ...card, textAlign: 'center' }}>
                                    <div style={{ color: kpi.color, fontSize: 20, marginBottom: 4 }}>{kpi.icon}</div>
                                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>{kpi.title}</Text>
                                    <Text style={{ color: kpi.color, fontSize: 22, fontWeight: 700, display: 'block' }}>{kpi.value}</Text>
                                    <Text style={{ color: t.textMuted, fontSize: 10 }}>{kpi.sub}</Text>
                                </Card>
                            </Col>
                        ))}
                    </Row>

                    {/* Charts */}
                    <Row gutter={[12, 12]}>
                        <Col xs={24} lg={12}>
                            <Card size="small" style={card}
                                title={<Text style={{ color: t.text, fontSize: 12 }}>Monthly Burn Rate</Text>}
                            >
                                <ResponsiveContainer width="100%" height={210}>
                                    <BarChart data={result.timeline} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                        <XAxis dataKey="label" stroke={t.textMuted} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                                        <YAxis stroke={t.textMuted} tick={{ fontSize: 9 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                                        <RTooltip
                                            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontSize: 11 }}
                                            formatter={(v: any) => [fmt(Number(v)), 'Burn']}
                                        />
                                        <Bar dataKey="burn" name="$/mo" fill={t.danger} radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card size="small" style={card}
                                title={<Text style={{ color: t.text, fontSize: 12 }}>Remaining Balance</Text>}
                            >
                                <ResponsiveContainer width="100%" height={210}>
                                    <LineChart data={result.timeline} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                        <XAxis dataKey="label" stroke={t.textMuted} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                                        <YAxis stroke={t.textMuted} tick={{ fontSize: 9 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                                        <RTooltip
                                            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontSize: 11 }}
                                            formatter={(v: any) => [fmt(Number(v)), 'Balance']}
                                        />
                                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                        <Line type="monotone" dataKey="balance" name="Balance" stroke={t.success} strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card size="small" style={card}
                                title={<Text style={{ color: t.text, fontSize: 12 }}>Team Hours / Month</Text>}
                            >
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={result.timeline} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                        <XAxis dataKey="label" stroke={t.textMuted} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                                        <YAxis stroke={t.textMuted} tick={{ fontSize: 9 }} />
                                        <RTooltip
                                            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontSize: 11 }}
                                            formatter={(v: any) => [`${Number(v).toFixed(1)} h`, 'Hours']}
                                        />
                                        <Bar dataKey="hours" name="Hours/mo" fill={t.accent} radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card size="small" style={card}
                                title={<Text style={{ color: t.text, fontSize: 12 }}>Active Employees / Month</Text>}
                            >
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={result.timeline} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                        <XAxis dataKey="label" stroke={t.textMuted} tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                                        <YAxis stroke={t.textMuted} tick={{ fontSize: 9 }} allowDecimals={false} />
                                        <RTooltip
                                            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontSize: 11 }}
                                            formatter={(v: any) => [v, 'Employees']}
                                        />
                                        <Bar dataKey="active" name="Active" fill={t.purple} radius={[3, 3, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            {/* ── ADD EMPLOYEE MODAL ──────────────────────────────────── */}
            <FormModal
                open={addMemberOpen}
                title="Add Employee to Simulation"
                onCancel={() => { setAddMemberOpen(false); addMemberForm.resetFields(); }}
                onOk={handleAddMember}
                okText="Add Employee"
                width={480}
            >
                <Form form={addMemberForm} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="userId" label="Existing user (optional)">
                        <Select
                            allowClear showSearch optionFilterProp="label"
                            placeholder="Pick a system user — rates auto-filled"
                            options={users
                                .filter(u => !members.some(m => m.userId === u.id))
                                .map(u => ({ value: u.id, label: `${u.fullName} ($${u.hourlyRate ?? 15}/hr)` }))}
                            onChange={uid => {
                                if (!uid) return;
                                const u = users.find(u => u.id === uid);
                                if (u) addMemberForm.setFieldsValue({ hourlyRate: u.hourlyRate ?? 15, weeklyHours: u.weeklyHoursCap ?? 0 });
                            }}
                        />
                    </Form.Item>
                    <Form.Item name="customName" label="Custom name (if no user selected)">
                        <Input placeholder="e.g. Future Hire" />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="hourlyRate" label="Default Rate ($/hr)" initialValue={15}>
                                <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="weeklyHours" label="Default Hrs/wk" initialValue={0}>
                                <InputNumber min={0} max={168} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Alert
                        type="info" showIcon
                        message="An initial period (sim start → sim end) is added automatically. Expand the employee row to add more periods."
                        style={{ fontSize: 12 }}
                    />
                </Form>
            </FormModal>

            {/* ── SAVE SCENARIO MODAL ─────────────────────────────────── */}
            <Modal
                open={saveModalOpen}
                title={<Space><SaveOutlined />Save Simulation Scenario</Space>}
                onCancel={() => setSaveModalOpen(false)}
                onOk={saveScenario}
                okText="Save"
            >
                <div style={{ marginTop: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 8 }}>
                        Give this scenario a name so you can recall it later.
                    </Text>
                    <Input placeholder="e.g. Summer Reduced Staff 2026" value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveScenario()} autoFocus />
                    <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 8, display: 'block' }}>
                        Saves: {members.filter(m => m.included).length} employees · ${laborBalance.toLocaleString()} balance · {simMonths} months starting {simStart.format('MMM YYYY')}
                    </Text>
                </div>
            </Modal>

            {/* ── ADD PERIOD MODAL ────────────────────────────────────── */}
            <FormModal
                open={!!addPeriodOpen}
                title={
                    <Space>
                        <CalendarOutlined />
                        Add Work Period — {members.find(m => m.simId === addPeriodOpen)?.name}
                    </Space>
                }
                onCancel={() => setAddPeriodOpen(null)}
                onOk={confirmAddPeriod}
                okText="Add Period"
                width={460}
            >
                <Form form={addPeriodForm} layout="vertical" style={{ marginTop: 16 }}>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="startDate" label="Active From">
                                <DatePicker style={{ width: '100%' }} placeholder="Sim start" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="endDate" label="Until">
                                <DatePicker style={{ width: '100%' }} placeholder="Sim end" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="hourlyRate" label="Rate ($/hr)" rules={[{ required: true }]}>
                                <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="weeklyHours" label="Hrs/wk" rules={[{ required: true }]}>
                                <InputNumber min={0} max={168} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Alert
                        type="info" showIcon style={{ fontSize: 12 }}
                        message="Leave 'Active From' or 'Until' blank to use the simulation start/end. Gap months (not covered by any period) contribute zero burn for this employee."
                    />
                </Form>
            </FormModal>
        </div>
    );
}
