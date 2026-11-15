/* ═══════════════════════════════════════════════════════════════════════
   Markdown → email-safe HTML.

   The same grammar the portal renders in the browser
   (frontend/src/components/Markdown.tsx), emitting HTML instead of React
   so a task description reads the same in an inbox as it does on the page.
   The two are deliberately kept in step: if one gains a construct, so
   should the other.

   WHAT "EMAIL-SAFE" MEANS HERE
   ────────────────────────────
   Every style is inline. Gmail strips <style> blocks and Outlook renders
   with Word's engine, so classes and anything structural beyond a table
   cannot be relied on. No flexbox, no grid, no custom fonts, no external
   CSS. Widths are fixed or percentage.

   ESCAPING
   ────────
   This builds an HTML string, so unlike the browser renderer it cannot
   rely on React to escape text. Every piece of author text goes through
   `esc` before it is concatenated, and `esc` is applied to the TEXT only —
   never to markup this file produces. Raw HTML a person typed into a
   description is therefore shown as characters, exactly as the portal
   shows it: `<script>` arrives in the inbox as `&lt;script&gt;`.

   Link targets are the one place a value lands in an attribute, so hrefs
   go through `safeUrl`, which admits http/https/mailto and refuses
   everything else — `javascript:` and `data:` degrade to plain text.
   ═══════════════════════════════════════════════════════════════════════ */

const INK = '#1f2933';
const INK_MUTED = '#52606d';
const RULE = '#e4e7eb';
const WELL = '#f5f7fa';
const LINK = '#1668dc';
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** HTML-escapes author text. Applied to every interpolated string. */
function esc(s: string): string {
    return (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Admits only schemes that cannot execute; everything else returns null. */
function safeUrl(raw: string): string | null {
    // Whitespace and control characters inside a scheme are a smuggling
    // trick (`java\nscript:`), and no legitimate URL needs them literally.
    const url = Array.from(raw)
        .filter((ch) => {
            const c = ch.codePointAt(0) ?? 0;
            return c > 0x20 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f);
        })
        .join('');
    if (!url) return null;
    if (/^(https?|mailto):/i.test(url)) return url;
    return null;
}

/* ─────────────────────────────── inline ─────────────────────────────── */

/*
 * Alternatives in precedence order: code first (its contents are literal),
 * then links (so emphasis inside a label does not eat the brackets), then
 * emphasis, longest delimiter first.
 *
 * The backreferences are numbered against the JOINED pattern — `\7` is the
 * `(\*\*\*|___)` group once every earlier group is counted. Getting that
 * wrong silently stops all emphasis from matching.
 */
const INLINE_SRC = [
    '`([^`\\n]+)`',                              // 1  code
    '!\\[([^\\]]*)\\]\\(\\s*([^)\\s]+)[^)]*\\)', // 2  alt   3 url   (image)
    '\\[([^\\]]+)\\]\\(\\s*([^)\\s]+)[^)]*\\)',  // 4  label 5 url   (link)
    '<((?:https?|mailto):[^>\\s]+)>',            // 6  autolink
    '(\\*\\*\\*|___)([^\\s][\\s\\S]*?)\\7',      // 7  delim 8 bold italic
    '(\\*\\*|__)([^\\s][\\s\\S]*?)\\9',          // 9  delim 10 bold
    '(\\*|_)([^\\s][\\s\\S]*?)\\11',             // 11 delim 12 italic
    '~~([^\\s][\\s\\S]*?)~~',                    // 13 strikethrough
    '(https?:\\/\\/[^\\s<>()\\[\\]]+)',          // 14 bare url
].join('|');

const G = {
    code: 1,
    imgAlt: 2, imgUrl: 3,
    linkLabel: 4, linkUrl: 5,
    autolink: 6,
    boldItalicDelim: 7, boldItalic: 8,
    boldDelim: 9, bold: 10,
    italicDelim: 11, italic: 12,
    strike: 13,
    bareUrl: 14,
} as const;

/**
 * `_` only opens emphasis at a word boundary.
 *
 * Without this, `some_long_name` comes out italic with the underscores
 * eaten — which is what happens to anyone pasting an identifier into a
 * description. Asterisks have no such problem.
 */
function underscoreIsEmphasis(text: string, start: number, end: number, delim: string): boolean {
    if (!delim.startsWith('_')) return true;
    const before = start > 0 ? text[start - 1] : ' ';
    const after = end < text.length ? text[end] : ' ';
    return !/\w/.test(before) && !/\w/.test(after);
}

const anchor = (href: string, label: string) =>
    `<a href="${esc(href)}" style="color:${LINK};text-decoration:underline;" target="_blank" rel="noopener noreferrer">${label}</a>`;

function inlineHtml(text: string): string {
    let out = '';
    let last = 0;

    // A fresh RegExp per call: a `g`-flagged pattern carries `lastIndex`,
    // and this function recurses for emphasis and link labels.
    const re = new RegExp(INLINE_SRC, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }

        const emphDelim = m[G.boldItalicDelim] ?? m[G.boldDelim] ?? m[G.italicDelim];
        if (emphDelim && !underscoreIsEmphasis(text, m.index, m.index + m[0].length, emphDelim)) {
            re.lastIndex = m.index + emphDelim.length;
            continue;
        }

        if (m.index > last) out += esc(text.slice(last, m.index));
        last = m.index + m[0].length;

        if (m[G.code] !== undefined) {
            out += `<code style="font-family:${MONO};font-size:13px;background:${WELL};`
                + `border:1px solid ${RULE};border-radius:3px;padding:1px 4px;">${esc(m[G.code])}</code>`;
        } else if (m[G.imgUrl] !== undefined) {
            // A link, not an <img>: a description should not make every
            // recipient's mail client fetch from an arbitrary host, and most
            // clients block remote images anyway.
            const href = safeUrl(m[G.imgUrl]);
            const label = esc(m[G.imgAlt] || 'image');
            out += href ? anchor(href, label) : esc(m[0]);
        } else if (m[G.linkUrl] !== undefined) {
            const href = safeUrl(m[G.linkUrl]);
            // A refused scheme shows the label and URL as written, so nothing
            // silently disappears from somebody's description.
            out += href ? anchor(href, inlineHtml(m[G.linkLabel])) : esc(m[0]);
        } else if (m[G.autolink] !== undefined || m[G.bareUrl] !== undefined) {
            const raw = (m[G.autolink] ?? m[G.bareUrl]) as string;
            const href = safeUrl(raw);
            out += href ? anchor(href, esc(raw)) : esc(raw);
        } else if (m[G.boldItalic] !== undefined) {
            out += `<strong><em>${inlineHtml(m[G.boldItalic])}</em></strong>`;
        } else if (m[G.bold] !== undefined) {
            out += `<strong>${inlineHtml(m[G.bold])}</strong>`;
        } else if (m[G.italic] !== undefined) {
            out += `<em>${inlineHtml(m[G.italic])}</em>`;
        } else if (m[G.strike] !== undefined) {
            out += `<s>${inlineHtml(m[G.strike])}</s>`;
        }
    }
    if (last < text.length) out += esc(text.slice(last));
    return out;
}

/* ─────────────────────────────── blocks ─────────────────────────────── */

type ListItem = { content: string; checked: boolean | null; children: Block[] };
type Block =
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'para'; lines: string[] }
    | { kind: 'code'; text: string }
    | { kind: 'quote'; blocks: Block[] }
    | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
    | { kind: 'table'; head: string[]; align: (string | null)[]; rows: string[][] }
    | { kind: 'hr' };

/** Indent in columns, counting a tab as four — how the common editors behave. */
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, '    ').length;

const BULLET_RE = /^[ \t]*([-*+])[ \t]+(.*)$/;
const ORDERED_RE = /^[ \t]*(\d{1,9})[.)][ \t]+(.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]+(.*)$/;
const HEADING_RE = /^[ \t]*(#{1,6})[ \t]+(.*?)[ \t]*#*$/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*(\S*)/;
const HR_RE = /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/;

const splitRow = (line: string) =>
    line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

const isTableDelimiter = (line: string) =>
    line.includes('-') && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line);

const startsABlock = (line: string) =>
    HEADING_RE.test(line) || FENCE_RE.test(line) || HR_RE.test(line)
    || BULLET_RE.test(line) || ORDERED_RE.test(line) || /^[ \t]*>/.test(line);

function parseBlocks(lines: string[]): Block[] {
    const blocks: Block[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }

        const fence = FENCE_RE.exec(line);
        if (fence) {
            const marker = fence[1][0];
            const closing = new RegExp(`^[ \\t]*\\${marker}{3,}[ \\t]*$`);
            const body: string[] = [];
            i++;
            while (i < lines.length && !closing.test(lines[i])) { body.push(lines[i]); i++; }
            if (i < lines.length) i++;
            blocks.push({ kind: 'code', text: body.join('\n') });
            continue;
        }

        const heading = HEADING_RE.exec(line);
        if (heading) {
            blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
            i++; continue;
        }

        if (HR_RE.test(line)) { blocks.push({ kind: 'hr' }); i++; continue; }

        if (/^[ \t]*>/.test(line)) {
            const inner: string[] = [];
            while (i < lines.length && /^[ \t]*>/.test(lines[i])) {
                inner.push(lines[i].replace(/^[ \t]*>[ \t]?/, '')); i++;
            }
            blocks.push({ kind: 'quote', blocks: parseBlocks(inner) });
            continue;
        }

        if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
            const head = splitRow(line);
            const align = splitRow(lines[i + 1]).map((c) =>
                c.startsWith(':') && c.endsWith(':') ? 'center'
                    : c.endsWith(':') ? 'right'
                        : c.startsWith(':') ? 'left' : null);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
                rows.push(splitRow(lines[i])); i++;
            }
            blocks.push({ kind: 'table', head, align, rows });
            continue;
        }

        const bullet = BULLET_RE.exec(line);
        const ordered = ORDERED_RE.exec(line);
        if (bullet || ordered) {
            const isOrdered = !!ordered;
            const baseIndent = indentOf(line);
            const start = isOrdered ? Number(ordered![1]) : 1;
            const items: ListItem[] = [];

            while (i < lines.length) {
                const cur = lines[i];
                if (!cur.trim()) {
                    const next = lines[i + 1];
                    if (!next || indentOf(next) < baseIndent
                        || !(BULLET_RE.test(next) || ORDERED_RE.test(next))) break;
                    i++; continue;
                }

                if (indentOf(cur) > baseIndent) {
                    const sub: string[] = [];
                    while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > baseIndent) {
                        sub.push(lines[i].slice(Math.min(indentOf(lines[i]), baseIndent + 2))); i++;
                    }
                    const parsed = parseBlocks(sub);
                    if (items.length) items[items.length - 1].children.push(...parsed);
                    else blocks.push(...parsed);
                    continue;
                }

                const b = BULLET_RE.exec(cur);
                const o = ORDERED_RE.exec(cur);
                if (!b && !o) break;
                if (indentOf(cur) < baseIndent) break;
                if (!!o !== isOrdered) break;

                let content = b ? b[2] : o![2];
                const task = TASK_RE.exec(content);
                const checked = task ? task[1].toLowerCase() === 'x' : null;
                if (task) content = task[2];
                items.push({ content, checked, children: [] });
                i++;
            }
            blocks.push({ kind: 'list', ordered: isOrdered, start, items });
            continue;
        }

        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && !startsABlock(lines[i])) {
            para.push(lines[i].trim()); i++;
        }
        if (para.length) blocks.push({ kind: 'para', lines: para });
        else i++; // nothing consumed — never loop forever
    }

    return blocks;
}

/* ─────────────────────────────── emit ───────────────────────────────── */

// Pixel sizes rather than the portal's tokens: an inbox has no tokens, and
// email bodies read a little larger than a dense admin page.
const HEADING_STYLE = [
    `font-size:19px;font-weight:700;color:${INK};`,
    `font-size:17px;font-weight:700;color:${INK};`,
    `font-size:15px;font-weight:600;color:${INK};`,
    `font-size:14px;font-weight:600;color:${INK};`,
    `font-size:14px;font-weight:600;color:${INK_MUTED};`,
    `font-size:13px;font-weight:600;color:${INK_MUTED};`,
];

function blocksHtml(blocks: Block[], depth = 0): string {
    return blocks.map((b, idx) => {
        const lastOne = idx === blocks.length - 1;
        const mb = lastOne ? 0 : 10;

        switch (b.kind) {
            case 'heading': {
                const rule = b.level <= 2
                    ? `border-bottom:1px solid ${RULE};padding-bottom:5px;`
                    : '';
                return `<div style="${HEADING_STYLE[b.level - 1]}line-height:1.35;`
                    + `margin:${idx === 0 ? 0 : 16}px 0 ${mb}px 0;${rule}">`
                    + `${inlineHtml(b.text)}</div>`;
            }

            case 'para':
                return `<p style="margin:0 0 ${mb}px 0;font-size:14px;line-height:1.6;color:${INK};">`
                    + b.lines.map((l) => inlineHtml(l)).join('<br />')
                    + '</p>';

            case 'code':
                // <pre> keeps the whitespace; the wrapper table stops long
                // lines stretching the 600px frame in Outlook.
                return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
                    + ` style="margin:0 0 ${mb}px 0;"><tr><td style="background:${WELL};`
                    + `border:1px solid ${RULE};border-radius:4px;padding:10px 12px;">`
                    + `<pre style="margin:0;font-family:${MONO};font-size:13px;line-height:1.5;`
                    + `color:${INK};white-space:pre-wrap;word-break:break-word;">`
                    + `${esc(b.text)}</pre></td></tr></table>`;

            case 'quote':
                return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
                    + ` style="margin:0 0 ${mb}px 0;"><tr>`
                    + `<td width="3" style="background:${LINK};"></td>`
                    + `<td style="background:${WELL};padding:8px 12px;color:${INK_MUTED};">`
                    + `${blocksHtml(b.blocks, depth + 1)}</td></tr></table>`;

            case 'list': {
                const hasTasks = b.items.some((it) => it.checked !== null);
                const items = b.items.map((it) => {
                    const box = it.checked === null
                        ? ''
                        : `<span style="color:${it.checked ? '#237804' : INK_MUTED};font-weight:700;">`
                        + `${it.checked ? '&#9745;' : '&#9744;'}</span>&nbsp;`;
                    const inner = it.children.length ? blocksHtml(it.children, depth + 1) : '';
                    return `<li style="margin:0 0 4px 0;font-size:14px;line-height:1.6;color:${INK};">`
                        + `${box}${inlineHtml(it.content)}${inner}</li>`;
                }).join('');
                const style = `margin:0 0 ${mb}px 0;padding-left:${hasTasks ? 2 : 22}px;`
                    + (hasTasks ? 'list-style:none;' : '');
                return b.ordered
                    ? `<ol start="${b.start}" style="${style}">${items}</ol>`
                    : `<ul style="${style}">${items}</ul>`;
            }

            case 'table': {
                const th = b.head.map((h, hi) =>
                    `<th align="${b.align[hi] ?? 'left'}" style="padding:6px 9px;`
                    + `border-bottom:1px solid ${RULE};background:${WELL};color:${INK_MUTED};`
                    + `font-size:12px;font-weight:600;text-align:${b.align[hi] ?? 'left'};">`
                    + `${inlineHtml(h)}</th>`).join('');
                const tr = b.rows.map((r) =>
                    '<tr>' + b.head.map((_, ci) =>
                        `<td align="${b.align[ci] ?? 'left'}" style="padding:6px 9px;`
                        + `border-bottom:1px solid ${RULE};font-size:13px;color:${INK};`
                        + `vertical-align:top;text-align:${b.align[ci] ?? 'left'};">`
                        + `${inlineHtml(r[ci] ?? '')}</td>`).join('') + '</tr>').join('');
                return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"`
                    + ` style="margin:0 0 ${mb}px 0;border-collapse:collapse;">`
                    + `<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
            }

            case 'hr':
                return `<div style="border-top:1px solid ${RULE};margin:16px 0;"></div>`;
        }
    }).join('');
}

/**
 * Renders a Markdown description as email-safe HTML.
 *
 * Returns an empty string for empty input, so a caller can decide whether
 * to render the section at all.
 */
export function markdownToEmailHtml(source?: string | null): string {
    if (!source || !source.trim()) return '';
    return blocksHtml(parseBlocks(source.replace(/\r\n?/g, '\n').split('\n')));
}

/**
 * The plain-text alternative part.
 *
 * Not a nicety: a message sent as HTML only scores badly with spam filters
 * and reads as a blank in text-only clients. This keeps the structure
 * legible — list markers and headings survive as text.
 */
export function markdownToEmailText(source?: string | null): string {
    if (!source || !source.trim()) return '';
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const out: (string | null)[] = lines.map((line) => {
        const h = HEADING_RE.exec(line);
        if (h) return `${h[2].toUpperCase()}`;
        if (HR_RE.test(line)) return '—'.repeat(20);
        // Dropped, not blanked: a blank line here would leave a gap in
        // the middle of the table.
        if (isTableDelimiter(line)) return null;
        const b = BULLET_RE.exec(line);
        if (b) {
            const task = TASK_RE.exec(b[2]);
            const indent = ' '.repeat(indentOf(line));
            if (task) return `${indent}[${task[1].toLowerCase() === 'x' ? 'x' : ' '}] ${task[2]}`;
            return `${indent}• ${b[2]}`;
        }
        const o = ORDERED_RE.exec(line);
        if (o) return `${' '.repeat(indentOf(line))}${o[1]}. ${o[2]}`;
        if (/^[ \t]*>/.test(line)) return `| ${line.replace(/^[ \t]*>[ \t]?/, '')}`;
        if (FENCE_RE.test(line)) return null;
        return line;
    });
    return out.filter((l): l is string => l !== null).join('\n')
        // Emphasis and link syntax carry no meaning without formatting.
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
        .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1 ($2)')
        .replace(/(\*\*\*|___)(\S[\s\S]*?)\1/g, '$2')
        .replace(/(\*\*|__)(\S[\s\S]*?)\1/g, '$2')
        .replace(/(^|[^\w*])\*(\S[\s\S]*?)\*(?![\w*])/g, '$1$2')
        // `_italic_` too, at word boundaries only so `some_var_name` survives.
        .replace(/(^|[^\w_])_(\S[\s\S]*?)_(?![\w_])/g, '$1$2')
        .replace(/~~(\S[\s\S]*?)~~/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
