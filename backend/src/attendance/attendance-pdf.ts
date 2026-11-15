import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, degrees } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import type { EmployeeWeeklySummary } from './attendance.service';
import { addDays, formatLocalLongDate, LAB_TZ } from '../common/tz';

/* Landscape A4. The previous portrait layout placed its last two columns
   beyond the right edge of the page. */
const W = 842;
const H = 595;
const M = 36;
const ROW_H = 18;
const HEAD_H = 22;

const INK = rgb(0.15, 0.15, 0.15);
const MUTED = rgb(0.45, 0.45, 0.45);
const FAINT = rgb(0.7, 0.7, 0.7);
const RED = rgb(0.85, 0.15, 0.15);
const GREEN = rgb(0.1, 0.5, 0.25);
const HEAD_BG = rgb(0.93, 0.93, 0.95);
const ZEBRA = rgb(0.97, 0.97, 0.98);

/** Strip characters that WinAnsi (Helvetica) cannot encode. */
function safe(text: unknown): string {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/[‘’‚]/g, "'")
        .replace(/[“”„]/g, '"')
        .replace(/…/g, '...')
        .replace(/[–—]/g, '-')
        .replace(/[^\x00-\xFF]/g, '');
}

const h1 = (n: number) => (n > 0 ? n.toFixed(1) : '-');
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 2) + '..' : s);

interface Col {
    label: string;
    width: number;
    align?: 'left' | 'right' | 'center';
}

interface Cell {
    text: string;
    color?: ReturnType<typeof rgb>;
    bold?: boolean;
}

class Sheet {
    page!: PDFPage;
    y = 0;
    private stamp: any = null;

    constructor(
        private readonly doc: PDFDocument,
        private readonly font: PDFFont,
        private readonly bold: PDFFont,
    ) {}

    async init() {
        try {
            this.stamp = await this.doc.embedPng(
                fs.readFileSync(path.resolve(__dirname, '..', '..', 'assets', 'stamp.png')),
            );
        } catch { /* stamp is optional */ }
        this.newPage();
    }

    newPage() {
        this.page = this.doc.addPage([W, H]);
        this.y = H - M;
        if (this.stamp) {
            this.page.drawImage(this.stamp, {
                x: W - 110, y: 44, width: 70, height: 70, rotate: degrees(-12), opacity: 0.85,
            });
        }
    }

    title(text: string, subtitle: string) {
        this.page.drawText(safe(text), { x: M, y: this.y - 14, size: 17, font: this.bold, color: INK });
        this.y -= 30;
        this.page.drawText(safe(subtitle), { x: M, y: this.y, size: 9.5, font: this.font, color: MUTED });
        this.y -= 12;
        this.page.drawText(
            safe(`Generated ${formatLocalLongDate(new Date())}  |  All times ${LAB_TZ} (Mountain Time)`),
            { x: M, y: this.y, size: 8, font: this.font, color: FAINT },
        );
        this.y -= 20;
    }

    heading(text: string) {
        if (this.y < M + 90) this.newPage();
        this.page.drawText(safe(text), { x: M, y: this.y - 10, size: 11.5, font: this.bold, color: INK });
        this.y -= 22;
    }

    note(text: string) {
        this.page.drawText(safe(text), { x: M, y: this.y - 6, size: 7.5, font: this.font, color: MUTED });
        this.y -= 14;
    }

    private place(text: string, x: number, width: number, align: Col['align'], size: number, f: PDFFont) {
        const tw = f.widthOfTextAtSize(text, size);
        if (align === 'right') return x + width - tw - 4;
        if (align === 'center') return x + (width - tw) / 2;
        return x + 4;
    }

    private drawHeader(cols: Col[]) {
        const total = cols.reduce((s, c) => s + c.width, 0);
        this.page.drawRectangle({ x: M, y: this.y - HEAD_H + 5, width: total, height: HEAD_H, color: HEAD_BG });
        let x = M;
        for (const c of cols) {
            const label = safe(c.label);
            this.page.drawText(label, {
                x: this.place(label, x, c.width, c.align, 7.5, this.bold),
                y: this.y - 10, size: 7.5, font: this.bold, color: rgb(0.3, 0.3, 0.3),
            });
            x += c.width;
        }
        this.y -= HEAD_H;
    }

    table(cols: Col[], rows: Cell[][]) {
        if (this.y < M + HEAD_H + ROW_H * 2 + 30) this.newPage();
        this.drawHeader(cols);
        const total = cols.reduce((s, c) => s + c.width, 0);
        rows.forEach((row, i) => {
            if (this.y < M + ROW_H + 24) {
                this.newPage();
                this.drawHeader(cols);
            }
            if (i % 2 === 0) {
                this.page.drawRectangle({ x: M, y: this.y - ROW_H + 5, width: total, height: ROW_H, color: ZEBRA });
            }
            let x = M;
            row.forEach((cell, ci) => {
                const c = cols[ci];
                const f = cell.bold ? this.bold : this.font;
                const text = safe(cell.text);
                this.page.drawText(text, {
                    x: this.place(text, x, c.width, c.align, 7.5, f),
                    y: this.y - 8, size: 7.5, font: f, color: cell.color ?? INK,
                });
                x += c.width;
            });
            this.y -= ROW_H;
        });
        this.y -= 14;
    }

    footers(label: string) {
        const n = this.doc.getPageCount();
        for (let i = 0; i < n; i++) {
            const p = this.doc.getPage(i);
            p.drawLine({ start: { x: M, y: 30 }, end: { x: W - M, y: 30 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
            p.drawText('AI/ML Lab Portal', { x: M, y: 18, size: 7, font: this.font, color: MUTED });
            const mid = safe(label);
            p.drawText(mid, { x: (W - this.font.widthOfTextAtSize(mid, 7)) / 2, y: 18, size: 7, font: this.font, color: MUTED });
            const pg = `Page ${i + 1} of ${n}`;
            p.drawText(pg, { x: W - M - this.font.widthOfTextAtSize(pg, 7), y: 18, size: 7, font: this.font, color: MUTED });
        }
    }
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const REMOTE_COLS: Col[] = [
    { label: 'Employee', width: 150 },
    { label: 'Employee ID', width: 80 },
    { label: 'Remote work', width: 100 },
    { label: 'Allowed %', width: 70, align: 'right' },
    { label: 'Max hours', width: 70, align: 'right' },
    { label: 'Weekly limit', width: 75, align: 'right' },
    { label: 'Actual remote', width: 80, align: 'right' },
    { label: 'Remaining', width: 70, align: 'right' },
    { label: 'Limit exceeded', width: 75, align: 'center' },
];

/** One row per employee. Unauthorised employees are listed explicitly. */
function remoteRows(list: Array<{
    fullName: string; employeeId: string | null;
    allowed: boolean; percent: number; maxHours: number | null;
    limitHours: number; actualHours: number; remainingHours: number; exceeded: boolean;
}>): Cell[][] {
    return list.map((r) => [
        { text: clip(r.fullName, 30) },
        { text: r.employeeId ?? '-', color: r.employeeId ? INK : FAINT },
        r.allowed ? { text: 'Authorized', color: GREEN, bold: true } : { text: 'Not permitted', color: MUTED },
        { text: r.allowed ? `${Number(r.percent)}%` : '-', color: r.allowed ? INK : FAINT },
        { text: r.allowed ? (r.maxHours != null ? `${r.maxHours.toFixed(1)}h` : 'No ceiling') : '-', color: r.allowed ? INK : FAINT },
        { text: r.allowed ? `${r.limitHours.toFixed(1)}h` : '0.0h', color: r.allowed ? INK : FAINT },
        { text: `${r.actualHours.toFixed(1)}h`, color: r.exceeded ? RED : INK, bold: r.exceeded },
        { text: r.allowed ? `${r.remainingHours.toFixed(1)}h` : '-', color: r.allowed ? INK : FAINT },
        r.exceeded ? { text: 'YES', color: RED, bold: true } : { text: 'No', color: MUTED },
    ]);
}

export async function buildWeeklyAttendancePdf(summaries: EmployeeWeeklySummary[], weekStart: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const sheet = new Sheet(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
    await sheet.init();
    const enforced = summaries.some((s) => s.enforcement);
    sheet.title('Weekly Attendance Report', `Week of ${weekStart} to ${addDays(weekStart, 6)}`);

    sheet.heading('Verified working hours');
    sheet.table(
        [
            { label: 'Employee', width: 140 },
            { label: 'Employee ID', width: 70 },
            ...DAY_LABELS.map((l) => ({ label: l, width: 40, align: 'right' as const })),
            { label: 'On-site', width: 50, align: 'right' },
            { label: 'Remote', width: 50, align: 'right' },
            { label: 'Verified', width: 52, align: 'right' },
            { label: 'Cap', width: 40, align: 'right' },
            { label: 'Reported', width: 52, align: 'right' },
            { label: 'Remaining', width: 56, align: 'right' },
        ],
        summaries.map((e) => [
            { text: clip(e.fullName, 28) },
            { text: e.employeeId ?? '-', color: e.employeeId ? INK : FAINT },
            ...e.days.map((d) => ({ text: h1(d.totalHours), color: d.totalHours > 0 ? INK : FAINT })),
            { text: e.onsiteHours.toFixed(1) },
            { text: e.remote.creditedHours.toFixed(1) },
            { text: e.verifiedHours.toFixed(1), bold: true },
            { text: e.weeklyHoursCap != null ? String(e.weeklyHoursCap) : '-', color: MUTED },
            { text: e.reportedHours.toFixed(1), color: e.overReported ? RED : INK, bold: e.overReported },
            { text: e.remainingReportableHours != null ? e.remainingReportableHours.toFixed(1) : '-', color: MUTED },
        ]),
    );
    sheet.note(
        'Verified = closed on-site sessions + remote hours up to the employee\'s remote limit. Sessions without a clock-out count as 0 until corrected. '
        + (enforced ? 'Reported hours are limited to verified hours for this week.' : 'Attendance-based report limits are not active for this week.'),
    );

    sheet.heading('Remote work');
    sheet.table(REMOTE_COLS, remoteRows(summaries.map((e) => ({
        fullName: e.fullName, employeeId: e.employeeId, ...e.remote,
    }))));

    sheet.footers(`Attendance - week of ${weekStart}`);
    return Buffer.from(await doc.save());
}

export async function buildBiweeklyAttendancePdf(
    week1: EmployeeWeeklySummary[], week2: EmployeeWeeklySummary[], week1Start: string,
): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const sheet = new Sheet(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
    await sheet.init();
    const week2Start = addDays(week1Start, 7);
    sheet.title('Biweekly Attendance Report', `${week1Start} to ${addDays(week1Start, 13)}`);

    const ids = [...new Set([...week1, ...week2].map((s) => s.userId))];
    const w1 = new Map(week1.map((s) => [s.userId, s]));
    const w2 = new Map(week2.map((s) => [s.userId, s]));
    const merged = ids
        .map((id) => ({ a: w1.get(id), b: w2.get(id), any: (w1.get(id) ?? w2.get(id))! }))
        .sort((x, y) => x.any.fullName.localeCompare(y.any.fullName));

    sheet.heading('Verified working hours');
    sheet.table(
        [
            { label: 'Employee', width: 170 },
            { label: 'Employee ID', width: 90 },
            { label: `Week 1 (${week1Start})`, width: 110, align: 'right' },
            { label: `Week 2 (${week2Start})`, width: 110, align: 'right' },
            { label: 'Total verified', width: 90, align: 'right' },
            { label: 'Cap (x2)', width: 70, align: 'right' },
            { label: 'Reported', width: 70, align: 'right' },
        ],
        merged.map(({ a, b, any }) => {
            const total = (a?.verifiedHours ?? 0) + (b?.verifiedHours ?? 0);
            const cap = any.weeklyHoursCap != null ? any.weeklyHoursCap * 2 : null;
            const reported = (a?.reportedHours ?? 0) + (b?.reportedHours ?? 0);
            return [
                { text: clip(any.fullName, 34) },
                { text: any.employeeId ?? '-', color: any.employeeId ? INK : FAINT },
                { text: (a?.verifiedHours ?? 0).toFixed(1) },
                { text: (b?.verifiedHours ?? 0).toFixed(1) },
                { text: total.toFixed(1), bold: true, color: cap != null && total > cap ? RED : INK },
                { text: cap != null ? String(cap) : '-', color: MUTED },
                { text: reported.toFixed(1), color: reported > total + 0.01 ? RED : INK },
            ];
        }),
    );

    sheet.heading('Remote work (both weeks combined)');
    sheet.table(REMOTE_COLS, remoteRows(merged.map(({ a, b, any }) => {
        const limit = (a?.remote.limitHours ?? 0) + (b?.remote.limitHours ?? 0);
        const actual = (a?.remote.actualHours ?? 0) + (b?.remote.actualHours ?? 0);
        return {
            fullName: any.fullName, employeeId: any.employeeId,
            allowed: any.remote.allowed, percent: any.remote.percent, maxHours: any.remote.maxHours,
            limitHours: limit, actualHours: actual,
            remainingHours: (a?.remote.remainingHours ?? 0) + (b?.remote.remainingHours ?? 0),
            exceeded: !!(a?.remote.exceeded || b?.remote.exceeded),
        };
    })));
    sheet.note('Allowed % and Max hours are the per-week policy; Weekly limit, Actual and Remaining are summed over the two weeks.');

    sheet.footers(`Attendance - ${week1Start} to ${addDays(week1Start, 13)}`);
    return Buffer.from(await doc.save());
}
