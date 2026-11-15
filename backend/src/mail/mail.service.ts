import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { markdownToEmailHtml, markdownToEmailText } from './markdown-email';

/**
 * Minimal SMTP mailer for transactional messages (password reset today).
 *
 * Configuration via environment:
 *   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
 *   MAIL_FROM  (e.g. "AI/ML Lab Portal <no-reply@portal.lan>")
 *
 * When SMTP_HOST is not set the service runs in "console mode": messages are
 * logged (including the full reset link) instead of sent, so development and
 * LAN-only deployments keep working without a mail server. The link is NEVER
 * returned in an HTTP response — only the server log or the mailbox.
 */
@Injectable()
export class MailService implements OnModuleInit {
    private readonly logger = new Logger(MailService.name);
    private transporter: Transporter | null = null;
    private from = 'AI/ML Lab Portal <no-reply@localhost>';

    constructor(private readonly config: ConfigService) {}

    onModuleInit() {
        const host = this.config.get<string>('SMTP_HOST');
        this.from = this.config.get<string>('MAIL_FROM') ?? this.from;

        if (!host) {
            this.logger.warn(
                'SMTP_HOST is not set — transactional email is disabled. ' +
                'Password-reset links will be printed to the server log instead. ' +
                'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM in .env to enable email delivery.',
            );
            return;
        }

        this.transporter = nodemailer.createTransport({
            host,
            port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
            secure: String(this.config.get<string>('SMTP_SECURE') ?? 'false') === 'true',
            auth: this.config.get<string>('SMTP_USER')
                ? {
                    user: this.config.get<string>('SMTP_USER'),
                    pass: this.config.get<string>('SMTP_PASS'),
                }
                : undefined,
            // Many internal/lab relays use self-signed certs
            tls: { rejectUnauthorized: false },
            connectionTimeout: 10_000,
        });

        // Verify in the background, with retries. A single failure here means
        // very little on this network — roughly half of all outbound TLS
        // connections are reset — so one bad attempt must not be reported as
        // "email is broken". Sending has its own retries regardless, so this
        // check is advisory: it tells the operator whether the credentials
        // are right, not whether any individual message will get through.
        void (async () => {
            for (let attempt = 1; attempt <= 5; attempt++) {
                try {
                    await this.transporter!.verify();
                    this.logger.log(`SMTP connected: ${host} (as ${this.config.get<string>('SMTP_USER')})`);
                    return;
                } catch (err: any) {
                    const message = err?.message ?? String(err);
                    // Credentials being refused is a real answer; stop asking.
                    if (/Invalid login|535|Username and Password not accepted/i.test(message)) {
                        this.logger.error(
                            `SMTP rejected the credentials for ${host}: ${message}. ` +
                            'Reset emails will be logged instead of sent until this is fixed.',
                        );
                        return;
                    }
                    if (attempt === 5) {
                        this.logger.warn(
                            `SMTP check could not complete for ${host} after ${attempt} attempts ` +
                            `(last: ${message}). Sending is still enabled and retries on its own.`,
                        );
                        return;
                    }
                    await new Promise((r) => setTimeout(r, 500 * attempt));
                }
            }
        })();
    }

    get isConfigured(): boolean {
        return this.transporter !== null;
    }

    /**
     * Sends the password-reset email. Never throws — delivery problems are
     * logged and the reset flow degrades to the server-log link so the
     * endpoint's response stays generic (no user enumeration either way).
     */
    async sendPasswordReset(
        to: string,
        fullName: string,
        resetLink: string,
        expiresAt: Date,
    ): Promise<boolean> {
        const firstName = (fullName ?? '').split(' ')[0] || 'there';
        const minutes = MailService.minutesUntil(expiresAt);
        const expiry = MailService.expiryPhrase(minutes);
        const subject = 'Reset your AI/ML Lab Portal password';

        // The plain-text alternative is not a formality: it is what text-only
        // clients show, what screen readers prefer, and what spam filters read
        // when deciding whether an HTML-only message is worth delivering.
        const text =
            `AI/ML LAB PORTAL — PASSWORD RESET\n` +
            `=================================\n\n` +
            `Hi ${firstName},\n\n` +
            `We received a request to reset the password on your AI/ML Lab Portal\n` +
            `account. Open this link to choose a new one:\n\n` +
            `  ${resetLink}\n\n` +
            `The link expires in ${expiry} and works only once. If it runs out,\n` +
            `request another from the sign-in page.\n\n` +
            `Didn't ask for this? Ignore this email — your password stays as it is.\n\n` +
            `--\n` +
            `AI/ML Lab Portal · Southern Utah University\n` +
            `Sent automatically — please do not reply.`;

        const html = this.brandedEmail({
            title: subject,
            kicker: 'Password reset',
            preheader: `Choose a new password — this link expires in ${expiry} and can be used once.`,
            greeting: `Hi ${firstName},`,
            introHtml: `We received a request to reset the password on your AI/ML Lab Portal account.
                        Choose a new one using the button below.`,
            buttonLabel: 'Choose a new password',
            buttonWidth: 270,
            link: resetLink,
            noticeHtml: `This link expires in <strong>${expiry}</strong> and works only once.
                         Request another at any time if it runs out.`,
            securityHtml: `<strong style="color:#3d4452;">Didn't ask for this?</strong>
                           You can ignore this email &mdash; your password stays as it is, and nobody can use
                           this link without opening it from your inbox.`,
        });

        if (!this.transporter) {
            // Console mode — dev / no-SMTP deployments
            this.logger.warn(
                `[Mail console-mode] Password reset for <${to}> — link (expires in ${minutes}m):\n${resetLink}`,
            );
            return false;
        }

        return this.deliver({ to, subject, text, html, link: resetLink, minutes, kind: 'Password-reset' });
    }

    /**
     * Sends the invitation that brings a new member into the portal.
     *
     * An administrator creates the account from an email address alone; this
     * message is the whole of the rest of the process. It therefore has to
     * carry more than a link: the recipient may never have heard of the
     * portal, so it says what it is, what they are about to do, and what they
     * will need to choose — their own username and password, which nobody
     * else ever sets or sees.
     */
    async sendRegistrationInvite(
        to: string,
        fullName: string,
        registrationLink: string,
        expiresAt: Date,
        invitedBy?: string,
    ): Promise<boolean> {
        const firstName = (fullName ?? '').split(' ')[0] || 'there';
        const minutes = MailService.minutesUntil(expiresAt);
        const expiry = MailService.expiryPhrase(minutes);
        const subject = 'Set up your AI/ML Lab Portal account';
        const from = invitedBy ? ` by ${invitedBy}` : '';

        const text =
            `AI/ML LAB PORTAL — ACCOUNT SETUP\n` +
            `================================\n\n` +
            `Hi ${firstName},\n\n` +
            `An account has been created for you${from} on the AI/ML Lab Portal —\n` +
            `where the lab keeps its schedules, attendance, tasks, projects,\n` +
            `inventory and reports.\n\n` +
            `Finish setting it up in three steps:\n\n` +
            `  1. Open this link:\n` +
            `     ${registrationLink}\n\n` +
            `  2. Choose your own username and password. Nobody else sets these,\n` +
            `     and nobody else can see them.\n\n` +
            `  3. Sign in, and you are in.\n\n` +
            `Your account is tied to ${to} — that is the address to sign in with\n` +
            `if you ever need a password reset.\n\n` +
            `The link expires in ${expiry} and works only once. If it runs out,\n` +
            `ask an administrator to send you another.\n\n` +
            `Weren't expecting this? Ignore the email — the account cannot be\n` +
            `used until somebody opens this link and sets a password.\n\n` +
            `--\n` +
            `AI/ML Lab Portal · Southern Utah University\n` +
            `Sent automatically — please do not reply.`;

        const steps = [
            ['Open the setup page', 'Use the button above, or the address at the bottom of this email.'],
            ['Choose your username and password', 'They are yours to pick. Nobody else sets them, and nobody else can see them.'],
            ['Sign in', `Your account is tied to <strong>${MailService.esc(to)}</strong> — the address to use if you ever need a password reset.`],
        ];

        const stepsHtml = `
        <tr>
          <td style="padding:6px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${steps.map(([headline, detail], i) => `
              <tr>
                <td width="34" valign="top" style="padding:0 0 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" valign="middle" width="26" height="26"
                          style="width:26px;height:26px;background:#cc0000;border-radius:13px;
                                 font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;
                                 font-weight:700;color:#ffffff;line-height:26px;">${i + 1}</td>
                    </tr>
                  </table>
                </td>
                <td valign="top" style="padding:0 0 16px;">
                  <div style="font-size:14.5px;font-weight:600;color:#14181f;line-height:1.45;">${headline}</div>
                  <div style="font-size:13.5px;color:#5b6472;line-height:1.6;margin-top:3px;">${detail}</div>
                </td>
              </tr>`).join('')}
            </table>
          </td>
        </tr>`;

        const html = this.brandedEmail({
            title: subject,
            kicker: 'Account setup',
            preheader: `Choose your username and password — this link expires in ${expiry}.`,
            greeting: `Welcome, ${firstName}.`,
            introHtml: `An account has been created for you${MailService.esc(from)} on the
                        <strong>AI/ML Lab Portal</strong> &mdash; where the lab keeps its schedules,
                        attendance, tasks, projects, inventory and reports.
                        One short step and it is yours.`,
            buttonLabel: 'Set up my account',
            buttonWidth: 250,
            link: registrationLink,
            afterButtonHtml: stepsHtml,
            noticeHtml: `This link expires in <strong>${expiry}</strong> and works only once.
                         If it runs out, ask an administrator to send you another.`,
            securityHtml: `<strong style="color:#3d4452;">Weren't expecting this?</strong>
                           You can ignore this email &mdash; the account cannot be used by anyone
                           until this link is opened and a password is set.`,
        });

        if (!this.transporter) {
            this.logger.warn(
                `[Mail console-mode] Registration invite for <${to}> — link (expires in ${minutes}m):\n${registrationLink}`,
            );
            return false;
        }

        return this.deliver({ to, subject, text, html, link: registrationLink, minutes, kind: 'Invitation' });
    }

    /**
     * The formal task-assignment notification.
     *
     * One message per recipient, by design: a single message addressed to
     * several people would put every assignee's address in everyone else's
     * inbox, and the caller sends these one at a time for exactly that
     * reason. Never throws — a delivery problem is reported by the return
     * value so one bad address cannot sink the rest of a batch.
     *
     * The description is Markdown, and it is rendered. Sending the raw
     * source would defeat the point: a task brief written with headings and
     * a checklist arrives as `## Goal` and `- [ ]` noise otherwise.
     */
    async sendTaskAssignment(opts: {
        to: string;
        recipientName: string;
        taskTitle: string;
        taskLink: string;
        projectName: string;
        /** Every assignee's display name — names only, never addresses. */
        assigneeNames: string[];
        description?: string | null;
        deadline?: string | null;
        priority?: string | null;
        status?: string | null;
        assignedBy?: string | null;
    }): Promise<boolean> {
        const firstName = (opts.recipientName ?? '').split(' ')[0] || 'there';
        const subject = `Task assigned: ${opts.taskTitle}`;
        const by = opts.assignedBy ? ` by ${opts.assignedBy}` : '';

        const rows: [string, string | null | undefined][] = [
            ['Task', opts.taskTitle],
            ['Project', opts.projectName],
            ['Assigned to', opts.assigneeNames.join(', ')],
            ['Priority', opts.priority],
            ['Status', opts.status],
            ['Due date', opts.deadline ? MailService.longDate(opts.deadline) : 'No due date set'],
            ['Assigned by', opts.assignedBy],
        ];

        /* ── plain-text alternative ──
           Not a nicety: HTML-only mail scores badly with spam filters and
           reads as a blank in text-only clients. */
        const descText = markdownToEmailText(opts.description);
        const text =
            `AI/ML LAB PORTAL — TASK ASSIGNMENT\n` +
            `==================================\n\n` +
            `Hi ${firstName},\n\n` +
            `You have been assigned a task${by} on the AI/ML Lab Portal.\n\n` +
            rows.filter(([, v]) => v).map(([k, v]) => `  ${k.padEnd(12)} ${v}`).join('\n') +
            `\n\n` +
            (descText
                ? `DESCRIPTION\n-----------\n${descText}\n\n`
                : `No description was provided.\n\n`) +
            `Open the task:\n  ${opts.taskLink}\n\n` +
            `You will be asked to sign in if you are not already, and will land\n` +
            `on this task once you are.\n\n` +
            `--\n` +
            `AI/ML Lab Portal · Southern Utah University\n` +
            `Sent by a colleague through the portal — please do not reply.`;

        /* ── the details table ──
           Two columns, fixed label width. Tables are the only layout an
           inbox can be relied on to render. */
        const detailRows = rows
            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
            .map(([label, value], i) => `
              <tr>
                <td valign="top" width="108"
                    style="padding:${i === 0 ? '0' : '7px'} 12px 7px 0;font-size:12.5px;
                           color:#7b8794;font-weight:600;text-transform:uppercase;
                           letter-spacing:0.04em;white-space:nowrap;">${MailService.esc(label)}</td>
                <td valign="top"
                    style="padding:${i === 0 ? '0' : '7px'} 0 7px;font-size:14px;
                           color:#1f2933;line-height:1.5;">${MailService.esc(String(value))}</td>
              </tr>`).join('');

        const descHtml = markdownToEmailHtml(opts.description);
        const descSection = descHtml
            ? `
        <tr>
          <td style="padding:22px 40px 0;">
            <div style="font-size:12.5px;color:#7b8794;font-weight:600;text-transform:uppercase;
                        letter-spacing:0.04em;padding-bottom:8px;">Description</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#ffffff;border:1px solid #e4e7eb;border-radius:6px;
                           padding:14px 16px;">${descHtml}</td>
              </tr>
            </table>
          </td>
        </tr>`
            : `
        <tr>
          <td style="padding:18px 40px 0;">
            <div style="font-size:13.5px;color:#7b8794;font-style:italic;">
              No description was provided for this task.
            </div>
          </td>
        </tr>`;

        const bodyHtml = `
        <tr>
          <td style="padding:6px 40px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#f5f7fa;border:1px solid #e4e7eb;border-radius:6px;">
              <tr>
                <td style="padding:16px 18px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    ${detailRows}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>${descSection}`;

        const html = this.brandedEmail({
            title: subject,
            kicker: 'Task assignment',
            preheader: `${opts.taskTitle} — ${opts.projectName}`
                + (opts.deadline ? `, due ${MailService.longDate(opts.deadline)}` : ''),
            greeting: `Hi ${firstName},`,
            introHtml: `You have been assigned a task${MailService.esc(by)} on the
                        <strong>AI/ML Lab Portal</strong>. The details are below &mdash;
                        the button opens the task itself.`,
            buttonLabel: 'View Task',
            buttonWidth: 190,
            link: opts.taskLink,
            afterButtonHtml: bodyHtml,
            noticeHtml: `The button opens this task directly. If you are not signed in you will be
                         asked to, and will land on the task straight afterwards.`,
            securityHtml: `<strong style="color:#3d4452;">Not expecting this?</strong>
                           Task assignments are made by project leads and administrators.
                           Reply to nobody &mdash; this address is not monitored; raise it in the
                           task's comments or with whoever assigned it.`,
        });

        if (!this.transporter) {
            this.logger.warn(
                `[Mail console-mode] Task assignment for <${opts.to}> — "${opts.taskTitle}"\n${opts.taskLink}`,
            );
            return false;
        }

        return this.deliver({
            to: opts.to, subject, text, html, link: opts.taskLink, kind: 'Task assignment',
        });
    }

    /** '2026-11-20' → 'Friday, 20 November 2026'. Falls back to the input. */
    private static longDate(iso: string): string {
        const d = new Date(`${iso}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
        });
    }

    private static minutesUntil(at: Date): number {
        return Math.max(1, Math.round((at.getTime() - Date.now()) / 60_000));
    }

    private static expiryPhrase(minutes: number): string {
        if (minutes < 60) return `${minutes} minutes`;
        const hours = Math.round(minutes / 60);
        if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
        const days = Math.round(hours / 24);
        return `${days} day${days === 1 ? '' : 's'}`;
    }

    /*
     * The artwork is attached, not fetched.
     *
     * These used to be <img src="https://host/email-logo.png">, which made
     * the logo's appearance depend on three things that keep going wrong:
     *
     *   1. Mail clients block remote images by default. Outlook and most
     *      phone clients show a placeholder and a "show images" prompt, so
     *      the header read as a broken box for most recipients.
     *   2. The URL was derived from the link in the message, which was
     *      itself built from the first entry of the CORS allow-list — a
     *      lab-only hostname no recipient could resolve.
     *   3. Even with the right hostname, the portal has to be publicly
     *      reachable at the moment the reader opens the email, which is not
     *      something a sent message should depend on.
     *
     * Embedding them as inline (CID) parts removes all three: the bytes are
     * in the message, so it renders the same offline, in a client with
     * remote images disabled, and years later. They are small on purpose —
     * about 54KB for the pair, against the 5.7MB site logo.
     */
    private static readonly INLINE_IMAGES: { cid: string; file: string }[] = [
        { cid: 'portal-logo', file: 'email-logo.png' },
        { cid: 'suu-logo', file: 'email-suu.png' },
    ];

    /**
     * The inline parts for one message.
     *
     * A missing file is skipped rather than fatal: every message is written
     * to read correctly with no images at all (each one carries alt text),
     * so a missing asset costs the logo and nothing else.
     */
    private inlineAttachments(): { filename: string; path: string; cid: string }[] {
        const dir = path.resolve(__dirname, '..', '..', 'assets');
        const out: { filename: string; path: string; cid: string }[] = [];
        for (const img of MailService.INLINE_IMAGES) {
            const full = path.join(dir, img.file);
            if (fs.existsSync(full)) {
                out.push({ filename: img.file, path: full, cid: img.cid });
            } else {
                this.logger.warn(
                    `Email artwork missing: ${full}. Messages will be sent without the logo.`,
                );
            }
        }
        return out;
    }

    private static esc(s: string): string {
        return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * The house style for every message the portal sends.
     *
     * Written the way email has to be written rather than the way the portal
     * is: nested tables, inline styles, fixed 600px width, no flexbox, no
     * external stylesheet. Outlook renders with Word's engine and Gmail strips
     * <style> blocks, so anything structural has to survive on table layout
     * and attributes alone.
     *
     * The images are loaded from the portal's own public hostname, derived
     * from the link so it always matches wherever the portal is reached from.
     * They are deliberately small (≈40KB) — the site logo is a 5.7MB PNG,
     * which would be absurd in an inbox — and every one carries alt text,
     * because most clients block images until the reader allows them. Every
     * message reads correctly with no images at all.
     *
     * Both the reset and the invitation come through here, so the two cannot
     * drift apart: a change to the frame is a change to both.
     */
    private brandedEmail(opts: {
        title: string;
        kicker: string;
        preheader: string;
        greeting: string;
        introHtml: string;
        buttonLabel: string;
        buttonWidth: number;
        link: string;
        afterButtonHtml?: string;
        noticeHtml: string;
        securityHtml: string;
    }): string {
        // The artwork is attached to the message rather than linked, so
        // there is no host to derive and nothing to cache-bust. See
        // inlineAttachments() for why.
        const link = MailService.esc(opts.link);

        return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${MailService.esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f4;">

<!-- Inbox preview line. Hidden in the body, shown next to the subject. -->
<div style="display:none;font-size:1px;color:#eef0f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
  ${opts.preheader}
  &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f4;">
  <tr>
    <td align="center" style="padding:32px 12px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;
                    border:1px solid #dfe3ea;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

        <!-- Header: the lab's own dark brand band -->
        <tr>
          <td align="center" style="background:#0d1117;padding:30px 24px 26px;">
            <img src="cid:portal-logo" width="72" height="72" alt="AI/ML Lab"
                 style="display:block;border:0;outline:none;width:72px;height:auto;margin:0 auto 14px;" />
            <div style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:.2px;line-height:1.3;">
              AI/ML Lab Portal
            </div>
            <div style="font-size:12px;color:#8b949e;margin-top:5px;letter-spacing:.4px;text-transform:uppercase;">
              ${opts.kicker}
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:34px 40px 10px;">
            <p style="margin:0 0 16px;font-size:17px;font-weight:600;color:#14181f;">${opts.greeting}</p>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#3d4452;">
              ${opts.introHtml}
            </p>
          </td>
        </tr>

        <!-- Bulletproof button: VML for Outlook, padded anchor elsewhere -->
        <tr>
          <td align="center" style="padding:14px 40px 8px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                         href="${link}" style="height:50px;v-text-anchor:middle;width:${opts.buttonWidth}px;"
                         arcsize="18%" stroke="f" fillcolor="#cc0000">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
                ${opts.buttonLabel}
              </center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="${link}"
               style="background:#cc0000;color:#ffffff;display:inline-block;font-size:16px;font-weight:600;
                      line-height:50px;text-align:center;text-decoration:none;width:${opts.buttonWidth}px;border-radius:9px;
                      font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              ${opts.buttonLabel}
            </a>
            <!--<![endif]-->
          </td>
        </tr>
${opts.afterButtonHtml ?? ''}
        <!-- Expiry notice -->
        <tr>
          <td style="padding:18px 40px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#fdf4f4;border:1px solid #f3d6d6;border-radius:9px;">
              <tr>
                <td style="padding:13px 16px;font-size:13.5px;line-height:1.6;color:#8a3030;">
                  ${opts.noticeHtml}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Fallback link -->
        <tr>
          <td style="padding:22px 40px 0;">
            <p style="margin:0 0 7px;font-size:12.5px;color:#6b7280;">
              If the button does not work, copy this address into your browser:
            </p>
            <p style="margin:0;font-size:12.5px;line-height:1.6;word-break:break-all;">
              <a href="${link}" style="color:#1668cc;text-decoration:underline;">${link}</a>
            </p>
          </td>
        </tr>

        <tr><td style="padding:24px 40px 0;"><div style="height:1px;background:#e7eaf0;line-height:1px;">&nbsp;</div></td></tr>

        <!-- Security note -->
        <tr>
          <td style="padding:18px 40px 30px;">
            <p style="margin:0;font-size:12.5px;line-height:1.65;color:#6b7280;">
              ${opts.securityHtml}
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="background:#f6f7f9;border-top:1px solid #e7eaf0;padding:22px 30px;">
            <img src="cid:suu-logo" width="42" height="35" alt="Southern Utah University"
                 style="display:block;border:0;outline:none;width:42px;height:auto;margin:0 auto 10px;opacity:.85;" />
            <div style="font-size:12px;color:#6b7280;line-height:1.6;">
              AI/ML Lab Portal &middot; Southern Utah University
            </div>
            <div style="font-size:11.5px;color:#9aa1ad;margin-top:5px;">
              Sent automatically &mdash; please do not reply to this message.
            </div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
    }

    /**
     * Sends a message, retrying transient connection failures.
     *
     * This server's route to the outside resets roughly half of its outbound
     * TLS connections — measured, not assumed: six identical test sends to
     * Gmail produced three accepted and three `ECONNRESET`, with the resets
     * happening before the SMTP greeting rather than at authentication. A
     * single attempt therefore fails about as often as it succeeds, while a
     * handful of attempts is reliable.
     *
     * Only connection-level failures are retried. A rejection from the server
     * — bad credentials, a refused recipient — is final and retrying it would
     * just repeat the same answer.
     */
    private async deliver(msg: {
        to: string; subject: string; text: string; html: string;
        link: string; kind: string;
        /** Only for messages that carry a time-limited link. */
        minutes?: number;
    }): Promise<boolean> {
        const RETRIABLE = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ESOCKET|EPIPE|Greeting never received|Connection timeout/i;
        const ATTEMPTS = 6;

        let lastError = '';
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            try {
                await this.transporter!.sendMail({
                    from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html,
                    attachments: this.inlineAttachments(),
                });
                if (attempt > 1) {
                    this.logger.log(`${msg.kind} email to <${msg.to}> sent on attempt ${attempt}`);
                } else {
                    this.logger.log(`${msg.kind} email sent to <${msg.to}>`);
                }
                return true;
            } catch (err: any) {
                lastError = err?.message ?? String(err);
                const transient = RETRIABLE.test(lastError);
                if (!transient || attempt === ATTEMPTS) break;

                // Short, growing pause: the resets are immediate, so waiting
                // long buys nothing, but spacing the attempts avoids hammering.
                await new Promise((r) => setTimeout(r, 400 * attempt));
            }
        }

        // The link goes in the log so a failed delivery is still recoverable
        // by hand. Only say "expires" when something actually does.
        const fallback = msg.minutes === undefined
            ? `Fallback link: ${msg.link}`
            : `Fallback link (expires in ${msg.minutes}m): ${msg.link}`;
        this.logger.error(
            `Failed to send ${msg.kind.toLowerCase()} email to <${msg.to}> after ${ATTEMPTS} attempts: ${lastError}. `
            + fallback,
        );
        return false;
    }
}
