import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { publicBaseUrl } from '../common/public-url';
import axios from 'axios';

export interface DiscordEmbed {
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
}

@Injectable()
export class DiscordService {
    private readonly logger = new Logger(DiscordService.name);

    // Fallback webhook — used when DISCORD_WEBHOOK_TASKS env var is not set
    private readonly FALLBACK_WEBHOOK = 'https://discord.com/api/webhooks/000000000000000000/REPLACE_WITH_YOUR_WEBHOOK';

    constructor(private readonly config: ConfigService) { }

    private async postWebhook(url: string, embeds: DiscordEmbed[], content?: string) {
        const effectiveUrl = url || this.FALLBACK_WEBHOOK;
        if (!effectiveUrl) {
            this.logger.warn('Discord webhook URL not configured');
            return;
        }
        try {
            await axios.post(effectiveUrl, { content, embeds });
        } catch (err) {
            this.logger.error('Discord webhook failed', err?.message);
        }
    }

    async postSchedule(weekStart: string, schedules: any[]) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_SCHEDULE', '');
        const fields = schedules.map((s) => ({
            name: `📅 ${s.user?.fullName ?? s.userId}`,
            value: Array.isArray(s.shifts)
                ? s.shifts.map((sh) => `**${sh.day}**: ${sh.start}–${sh.end}${sh.note ? ` _(${sh.note})_` : ''}`).join('\n') || '_No shifts_'
                : '_No shifts_',
            inline: false,
        }));

        await this.postWebhook(url, [
            {
                title: `📆 Unified Schedule — Week of ${weekStart}`,
                color: 0x5865f2,
                fields: fields.slice(0, 25), // Discord embed limit
                footer: { text: 'AI-Server Lab Management' },
                timestamp: new Date().toISOString(),
            },
        ]);
    }

    async postTaskAssigned(
        taskTitle: string,
        assigneeName: string,
        deadline: string | null,
        projectName: string,
        assignerName?: string,
        taskId?: string,
        description?: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_TASKS', '') || this.FALLBACK_WEBHOOK;
        // The public address, not the first entry of the CORS allow-list:
        // that was a lab-only hostname, so every link posted here pointed
        // somewhere nobody outside the lab could open.
        const frontendUrl = publicBaseUrl(this.config);
        const viewUrl = `${frontendUrl}/tasks`;

        const fields: Array<{ name: string; value: string; inline?: boolean }> = [
            // Row 1 — three inline meta fields
            { name: '👤  Assigned by', value: assignerName ?? 'Unknown',                                   inline: true },
            { name: '🗂️  Project',     value: projectName,                                                  inline: true },
            { name: '⏰  Deadline',    value: deadline ? `\`${deadline}\`` : '*Not set*',                   inline: true },
            // Thin visual separator
            { name: '\u200b',          value: '\u200b',                                                     inline: false },
        ];

        // Description block — only when present
        if (description?.trim()) {
            const truncated = description.length > 800
                ? description.substring(0, 797) + '…'
                : description;
            fields.push({
                name:  '📝  Description',
                value: `>>> ${truncated}`,
                inline: false,
            });
        }

        // Portal link — always last
        fields.push({
            name:  '🔗  View in Portal',
            value: `[Open Tasks Page](${viewUrl}) — log in and navigate to **Tasks**`,
            inline: false,
        });

        await this.postWebhook(
            url,
            [
                {
                    // author doubles as a clean header banner
                    title:       taskTitle,
                    description: `**${assigneeName}** has been assigned a new task.\nReview the details below and get started whenever you're ready.`,
                    color:       0xF4900C,   // vivid amber — instantly recognisable as a task notification
                    fields,
                    footer:    { text: '─────────────────────────────\nAI-Server Lab Management  ·  AI/ML Lab Portal' },
                    timestamp: new Date().toISOString(),
                },
            ],
            // Plain-text content above the embed — renders as a "ping-style" headline
            `📬  **New task assigned to ${assigneeName}**`,
        );
    }

    async postTaskUpdated(
        taskTitle: string,
        assigneeName: string,
        deadline: string | null,
        projectName: string,
        editorName: string,
        changedFields: string[],
        taskId?: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_TASKS', '') || this.FALLBACK_WEBHOOK;
        const frontendUrl = publicBaseUrl(this.config);
        const viewUrl = `${frontendUrl}/tasks`;

        const changedList = changedFields.map(f => `• ${f}`).join('\n');

        await this.postWebhook(
            url,
            [
                {
                    title:       taskTitle,
                    color:       0x3B82F6,
                    fields: [
                        { name: '👤  Assigned to',   value: assigneeName,                                    inline: true },
                        { name: '✏️  Updated by',    value: editorName,                                      inline: true },
                        { name: '⏰  Deadline',       value: deadline ? `\`${deadline}\`` : '*Not set*',      inline: true },
                        { name: '🔄  Changed',        value: changedList,                                     inline: false },
                        { name: '🔗  Portal',         value: `[Open Tasks Page](${viewUrl})`,                 inline: false },
                    ],
                    footer:    { text: 'AI-Server Lab Management' },
                    timestamp: new Date().toISOString(),
                },
            ],
            `🔔  **Task updated: ${taskTitle}**`,
        );
    }

    async postTaskPendingReview(
        taskTitle: string,
        assigneeName: string,
        deadline: string | null,
        projectName: string,
        taskId?: string,
        description?: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_TASKS', '') || this.FALLBACK_WEBHOOK;
        const frontendUrl = publicBaseUrl(this.config);
        const viewUrl = `${frontendUrl}/tasks`;

        const fields: Array<{ name: string; value: string; inline?: boolean }> = [
            { name: '👤  Submitted by', value: assigneeName,                                              inline: true },
            { name: '🗂️  Project',      value: projectName,                                               inline: true },
            { name: '⏰  Deadline',     value: deadline ? `\`${deadline}\`` : '*Not set*',                inline: true },
            { name: '\u200b',           value: '\u200b',                                                  inline: false },
        ];

        if (description?.trim()) {
            const truncated = description.length > 500 ? description.substring(0, 497) + '…' : description;
            fields.push({ name: '📝  Description', value: `>>> ${truncated}`, inline: false });
        }

        fields.push({
            name:  '🔗  View in Portal',
            value: `[Open Tasks Page](${viewUrl}) — log in and navigate to **Tasks**`,
            inline: false,
        });

        await this.postWebhook(
            url,
            [
                {
                    title:       taskTitle,
                    description: `**${assigneeName}** has submitted this task for review.\nPlease assess the work and approve or return it.`,
                    color:       0xBC8CFF,   // purple — matches Pending Review status colour
                    fields,
                    footer:    { text: '─────────────────────────────\nAI-Server Lab Management  ·  AI/ML Lab Portal' },
                    timestamp: new Date().toISOString(),
                },
            ],
            `📋  **Task submitted for review: ${taskTitle}**`,
        );
    }

    async postReportReminder(unsubmittedUsers: string[], weekStart: string) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_REPORTS', '');
        const names = unsubmittedUsers.join(', ');
        await this.postWebhook(
            url,
            [
                {
                    title: '⚠️ Weekly Report Reminder',
                    description: `The following team members have **not yet submitted** their weekly report for week of **${weekStart}**:`,
                    color: 0xff4444,
                    fields: [{ name: 'Pending Members', value: names || 'None' }],
                    footer: { text: 'AI-Server Lab Management' },
                    timestamp: new Date().toISOString(),
                },
            ],
        );
    }

    async postScheduleImage(weekStart: string, imageBuffer: Buffer): Promise<void> {
        const url = this.config.get<string>('DISCORD_WEBHOOK_SCHEDULE', '') || this.FALLBACK_WEBHOOK;
        if (!url) { this.logger.warn('Discord webhook URL not configured'); return; }
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const FormData = require('form-data');
            const form = new FormData();
            form.append('payload_json', JSON.stringify({
                content: `📆 **Schedule — Week of ${weekStart}**`,
            }));
            form.append('files[0]', imageBuffer, {
                filename: `schedule-${weekStart}.png`,
                contentType: 'image/png',
            });
            await axios.post(url, form, { headers: form.getHeaders() });
        } catch (err: any) {
            this.logger.error('Discord schedule image post failed', err?.message);
            throw err;
        }
    }

    async postInventoryAlert(itemName: string, quantity: number, location: string) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_TASKS', '') || this.config.get<string>('DISCORD_WEBHOOK_SCHEDULE', '');
        await this.postWebhook(url, [
            {
                title: '📦 Low Inventory Alert',
                color: 0xff0000,
                fields: [
                    { name: 'Item', value: itemName, inline: true },
                    { name: 'Quantity', value: String(quantity), inline: true },
                    { name: 'Location', value: location || 'Unknown', inline: true },
                ],
                footer: { text: 'AI-Server Lab Management' },
                timestamp: new Date().toISOString(),
            },
        ]);
    }

    // ─── Reports ──────────────────────────────────────────────────────────────

    async postReportSubmitted(submitterName: string, weekLabel: string, isResubmit: boolean) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_REPORTS', '');
        if (!url) return;
        const frontendUrl = publicBaseUrl(this.config);
        const color = isResubmit ? 0xDB6D28 : 0xF4900C;
        const verb  = isResubmit ? 'resubmitted' : 'submitted';
        await this.postWebhook(url, [{
            title: isResubmit ? '🔄  Report Resubmitted' : '📋  New Report Submitted',
            color,
            fields: [
                { name: '👤  Submitted by', value: submitterName,                                            inline: true },
                { name: '📅  Week',          value: weekLabel,                                                inline: true },
                { name: '🔗  Portal',        value: `[Open Reports Page](${frontendUrl}/reports)`,           inline: false },
            ],
            footer: { text: 'AI-Server Lab Management' },
            timestamp: new Date().toISOString(),
        }], `📋  **${submitterName} has ${verb} their weekly report**`);
    }

    async postReportReviewed(
        submitterName: string,
        status: 'approved' | 'revision',
        weekLabel: string,
        reviewerName: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_REPORTS', '');
        if (!url) return;
        const frontendUrl = publicBaseUrl(this.config);
        const isApproved = status === 'approved';
        await this.postWebhook(url, [{
            title: isApproved ? '✅  Report Approved' : '🔁  Report Needs Revision',
            color: isApproved ? 0x3FB950 : 0xF85149,
            fields: [
                { name: '👤  Employee',      value: submitterName,                                            inline: true },
                { name: '✏️  Reviewed by',  value: reviewerName,                                             inline: true },
                { name: '📅  Week',          value: weekLabel,                                                inline: true },
                { name: '🔗  Portal',        value: `[Open Reports Page](${frontendUrl}/reports)`,           inline: false },
            ],
            footer: { text: 'AI-Server Lab Management' },
            timestamp: new Date().toISOString(),
        }], `${isApproved ? '✅' : '🔁'}  **Report for ${submitterName} — ${isApproved ? 'Approved' : 'Needs Revision'}**`);
    }

    // ─── Tickets ──────────────────────────────────────────────────────────────

    async postTicketSubmitted(
        submitterName: string,
        ticketType: string,
        title: string,
        _ticketId?: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_TICKETS', '');
        if (!url) return;
        const frontendUrl = publicBaseUrl(this.config);
        const typeLabel = ticketType === 'bug' ? 'Bug Report' : 'Access Request';
        await this.postWebhook(url, [{
            title: `🎫  New ${typeLabel}`,
            color: 0xBC8CFF,
            fields: [
                { name: '👤  Submitted by', value: submitterName,                                            inline: true },
                { name: '📂  Type',          value: typeLabel,                                                inline: true },
                { name: '📌  Title',         value: title,                                                   inline: false },
                { name: '🔗  Portal',        value: `[Open Tickets Page](${frontendUrl}/tickets)`,          inline: false },
            ],
            footer: { text: 'AI-Server Lab Management' },
            timestamp: new Date().toISOString(),
        }], `🎫  **New ${typeLabel} from ${submitterName}**`);
    }

    async postTicketResolved(
        submitterName: string,
        ticketType: string,
        title: string,
        resolvedBy: string,
        resolution: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_TICKETS', '');
        if (!url) return;
        const frontendUrl = publicBaseUrl(this.config);
        const typeLabel  = ticketType === 'bug' ? 'Bug Report' : 'Access Request';
        const isApproved = resolution === 'approved';
        await this.postWebhook(url, [{
            title: `${isApproved ? '✅' : '❌'}  Ticket ${isApproved ? 'Resolved' : 'Rejected'}`,
            color: isApproved ? 0x3FB950 : 0xF85149,
            fields: [
                { name: '👤  Submitted by', value: submitterName,                                            inline: true },
                { name: '✏️  Resolved by',  value: resolvedBy,                                              inline: true },
                { name: '📂  Type',          value: typeLabel,                                               inline: true },
                { name: '📌  Title',         value: title,                                                   inline: false },
                { name: '🔗  Portal',        value: `[Open Tickets Page](${frontendUrl}/tickets)`,          inline: false },
            ],
            footer: { text: 'AI-Server Lab Management' },
            timestamp: new Date().toISOString(),
        }], `${isApproved ? '✅' : '❌'}  **Ticket ${isApproved ? 'resolved' : 'rejected'}: ${title}**`);
    }

    // ─── Files ────────────────────────────────────────────────────────────────

    async postVideoTutorialPending(
        uploaderName: string,
        title: string,
        playlistTitle: string,
        mediaType: string,
    ) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_FILES', '');
        if (!url) return;
        const frontendUrl = publicBaseUrl(this.config);
        await this.postWebhook(url, [{
            title: '🎬  New Video Tutorial Awaiting Review',
            color: 0xD29922,
            fields: [
                { name: '👤  Uploaded by', value: uploaderName,                                              inline: true },
                { name: '📂  Type',         value: mediaType,                                                inline: true },
                { name: '📌  Title',        value: title,                                                    inline: false },
                { name: '🎵  Playlist',     value: playlistTitle,                                            inline: false },
                { name: '🔗  Portal',       value: `[Open Video Tutorials](${frontendUrl}/video-tutorials)`, inline: false },
            ],
            footer: { text: 'AI-Server Lab Management' },
            timestamp: new Date().toISOString(),
        }], `🎬  **New ${mediaType} uploaded by ${uploaderName} — awaiting review**`);
    }

    async postFilePending(uploaderName: string, filename: string, fileType: string) {
        const url = this.config.get<string>('DISCORD_WEBHOOK_FILES', '');
        if (!url) return;
        const frontendUrl = publicBaseUrl(this.config);
        await this.postWebhook(url, [{
            title: '📎  New File Awaiting Review',
            color: 0xD29922,
            fields: [
                { name: '👤  Uploaded by', value: uploaderName,                                              inline: true },
                { name: '📂  Type',         value: fileType,                                                 inline: true },
                { name: '📄  File',         value: filename,                                                 inline: false },
                { name: '🔗  Portal',       value: `[Open Files Page](${frontendUrl}/files)`,               inline: false },
            ],
            footer: { text: 'AI-Server Lab Management' },
            timestamp: new Date().toISOString(),
        }], `📎  **New ${fileType} uploaded by ${uploaderName} — awaiting review**`);
    }
}
