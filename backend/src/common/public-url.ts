import type { ConfigService } from '@nestjs/config';

/* ═══════════════════════════════════════════════════════════════════════
   The address to put in a link that leaves the building.

   WHY THIS EXISTS
   ───────────────
   `FRONTEND_URL` is a CORS allow-list. It holds every origin the portal
   may legitimately be reached on — the LAN name, localhost, two bare IPs,
   and the public hostname — and its order carries no meaning.

   Nine places in the Discord service, and then the task-assignment email,
   each read it as `FRONTEND_URL.split(',')[0]` and treated that as "the
   site address". The first entry happens to be `http://portal.lan:8090`,
   a name that resolves only inside the lab, so every emailed and posted
   link pointed somewhere the recipient's browser could not reach.

   Two different questions were being answered by one setting. `PUBLIC_URL`
   answers the second one explicitly.

   WITHOUT PUBLIC_URL SET
   ──────────────────────
   The allow-list is still searched rather than blindly indexed, preferring
   an https origin whose hostname looks like one the outside world can
   resolve. That is a fallback, not the mechanism: set `PUBLIC_URL`.
   ═══════════════════════════════════════════════════════════════════════ */

/** True for a hostname that only means something on this network. */
function isLocalOnly(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localdomain')) return true;
    // Any bare IP literal — a public one is still not a name people can be
    // sent to, and these rotate.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
    if (h.includes(':')) return true;            // IPv6 literal
    if (!h.includes('.')) return true;           // a single-label host
    return false;
}

/** Scores an origin for how safe it is to send to somebody outside. */
function score(raw: string): number {
    try {
        const u = new URL(raw);
        if (isLocalOnly(u.hostname)) return 0;
        // https on the default port is the shape a real public address takes.
        if (u.protocol === 'https:' && !u.port) return 3;
        if (u.protocol === 'https:') return 2;
        return 1;
    } catch {
        return 0;
    }
}

/**
 * The origin to build outbound links from, with no trailing slash.
 *
 * Use this for anything a person outside the running process will click:
 * email bodies, Discord embeds, anything pasted into a message. Never
 * index `FRONTEND_URL` directly.
 */
export function publicBaseUrl(config: ConfigService): string {
    const explicit = config.get<string>('PUBLIC_URL')?.trim();
    if (explicit) return explicit.replace(/\/+$/, '');

    const list = (config.get<string>('FRONTEND_URL') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    let best = '';
    let bestScore = -1;
    for (const candidate of list) {
        const s = score(candidate);
        if (s > bestScore) { bestScore = s; best = candidate; }
    }

    // Everything on the list is lab-local, or the list is empty: nothing
    // better to offer than the first entry, which is what the old code
    // always used.
    return (best || list[0] || 'http://localhost:5173').replace(/\/+$/, '');
}

/** A link straight to one task's details. */
export function taskUrl(config: ConfigService, taskId: string): string {
    return `${publicBaseUrl(config)}/tasks?taskId=${encodeURIComponent(taskId)}`;
}
