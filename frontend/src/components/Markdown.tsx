import { type ReactNode, type CSSProperties, Fragment } from 'react';
import { useTheme } from '../theme/useTheme';
import { space, fontSize, radius, fontFamilyMono, alpha } from '../theme/tokens';
import { markdownToPlainText } from '../utils/markdown';

/* ═══════════════════════════════════════════════════════════════════════
   Markdown for descriptions people type.

   SAFETY
   ──────
   This renders to React elements. There is no HTML string anywhere in it,
   no `dangerouslySetInnerHTML`, and therefore nothing for a sanitiser to
   clean up afterwards: markup a person types into a description is text,
   and React escapes text. A description containing `<script>alert(1)</script>`
   renders those characters on the page and does nothing else.

   Link targets are the one place a string reaches a browser API, so every
   href goes through `safeHref`, which admits http, https, mailto and
   in-app paths and refuses everything else — `javascript:`, `data:` and
   friends come out as plain text.

   WHY NOT A LIBRARY
   ─────────────────
   Two reasons. This server's route to the npm registry drops connections
   partway through an install (see frontend/Dockerfile), so adding ~40
   transitive packages is a deployment risk for a page of formatting. And
   every node here is styled from the theme tokens, which is what keeps a
   rendered description looking like the rest of the portal rather than
   like a web page embedded in it — with react-markdown that styling work
   would be the same, just spread across a component map.

   SUPPORTED
   ─────────
   ATX headings, bold, italic, bold-italic, strikethrough, inline code,
   fenced code blocks, unordered and ordered lists (nested), task list
   items, blockquotes, horizontal rules, links, autolinks, bare URLs, and
   GFM pipe tables. Images are deliberately rendered as a link rather than
   fetched: a task description should not be able to make every viewer's
   browser call out to an arbitrary host.
   ═══════════════════════════════════════════════════════════════════════ */

/** Admits only schemes that cannot execute. Everything else renders as text. */
function safeHref(raw: string): string | null {
    /*
     * Whitespace and control characters inside a scheme are a smuggling
     * trick (`java\nscript:`), and no legitimate URL needs them literally.
     * Filtered by code point rather than by a character class, because a
     * regex holding literal control characters is itself a lint error and
     * easy to get subtly wrong.
     */
    const url = Array.from(raw)
        .filter((ch) => {
            const c = ch.codePointAt(0) ?? 0;
            return c > 0x20 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f);
        })
        .join('');
    if (!url) return null;
    if (/^(https?|mailto):/i.test(url)) return url;
    // In-app links and fragments, which the portal itself produces.
    if (/^\/[^/]/.test(url) || url.startsWith('#')) return url;
    return null;
}

/* ─────────────────────────────── inline ─────────────────────────────── */

/*
 * One pass over a line of text. Alternatives are ordered by precedence:
 * code first, because its contents are literal; then links, so that
 * emphasis inside a label does not eat the brackets; then emphasis,
 * longest delimiter first.
 *
 * The backreferences are numbered against the JOINED pattern, not against
 * each alternative — `\7` below is the `(\*\*\*|___)` group once all the
 * earlier groups are counted. Getting that wrong silently stops every kind
 * of emphasis from matching, so `G` records the indices in one place.
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
 * Without this, `some_long_name` and `__init__` come out italic or bold
 * with the underscores eaten — which is exactly what happens to anyone
 * pasting an identifier into a description. Asterisks have no such
 * problem and are left alone.
 */
function underscoreIsEmphasis(text: string, start: number, end: number, delim: string): boolean {
    if (!delim.startsWith('_')) return true;
    const before = start > 0 ? text[start - 1] : ' ';
    const after = end < text.length ? text[end] : ' ';
    return !/\w/.test(before) && !/\w/.test(after);
}

function InlineText({ text }: { text: string }): ReactNode {
    const { t } = useTheme();
    const codeStyle: CSSProperties = {
        fontFamily: fontFamilyMono,
        fontSize: '0.9em',
        background: t.surfaceSunken,
        border: `1px solid ${t.borderSubtle}`,
        borderRadius: radius.sm,
        padding: '0.1em 0.35em',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
    };
    const linkStyle: CSSProperties = {
        color: t.accent, textDecoration: 'underline', wordBreak: 'break-word',
    };

    const out: ReactNode[] = [];
    let last = 0;
    let key = 0;

    /*
     * A fresh RegExp per call, deliberately.
     *
     * A `g`-flagged regex carries `lastIndex`, so one shared at module scope
     * is mutable state written to during a render. This component also
     * recurses — emphasis and link labels are parsed by a nested
     * `InlineText` — so a single shared instance is one scheduling change
     * away from two scans treading on each other's position.
     */
    const re = new RegExp(INLINE_SRC, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        // A zero-length match would spin forever.
        if (m[0] === '') { re.lastIndex++; continue; }

        const emphDelim = m[G.boldItalicDelim] ?? m[G.boldDelim] ?? m[G.italicDelim];
        if (emphDelim && !underscoreIsEmphasis(text, m.index, m.index + m[0].length, emphDelim)) {
            // Leave it as literal text and carry on just past the delimiter.
            re.lastIndex = m.index + emphDelim.length;
            continue;
        }

        if (m.index > last) out.push(text.slice(last, m.index));
        last = m.index + m[0].length;
        const k = `i${key++}`;

        if (m[G.code] !== undefined) {
            out.push(<code key={k} style={codeStyle}>{m[G.code]}</code>);
        } else if (m[G.imgUrl] !== undefined) {
            // Rendered as a link, never fetched — see the header note.
            const href = safeHref(m[G.imgUrl]);
            const label = m[G.imgAlt] || 'image';
            out.push(href
                ? <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" style={linkStyle}>{label}</a>
                : <Fragment key={k}>{m[0]}</Fragment>);
        } else if (m[G.linkUrl] !== undefined) {
            const href = safeHref(m[G.linkUrl]);
            out.push(href
                ? (
                    <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" style={linkStyle}>
                        <InlineText text={m[G.linkLabel]} />
                    </a>
                )
                // A refused scheme shows the label and the URL as written, so
                // nothing silently disappears from someone's description.
                : <Fragment key={k}>{m[0]}</Fragment>);
        } else if (m[G.autolink] !== undefined || m[G.bareUrl] !== undefined) {
            const raw = (m[G.autolink] ?? m[G.bareUrl]) as string;
            const href = safeHref(raw);
            out.push(href
                ? <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" style={linkStyle}>{raw}</a>
                : <Fragment key={k}>{raw}</Fragment>);
        } else if (m[G.boldItalic] !== undefined) {
            out.push(<strong key={k} style={{ fontWeight: 600 }}><em><InlineText text={m[G.boldItalic]} /></em></strong>);
        } else if (m[G.bold] !== undefined) {
            out.push(<strong key={k} style={{ fontWeight: 600 }}><InlineText text={m[G.bold]} /></strong>);
        } else if (m[G.italic] !== undefined) {
            out.push(<em key={k}><InlineText text={m[G.italic]} /></em>);
        } else if (m[G.strike] !== undefined) {
            out.push(<del key={k}><InlineText text={m[G.strike]} /></del>);
        }
    }
    if (last < text.length) out.push(text.slice(last));
    return <>{out}</>;
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

        // fenced code — contents taken verbatim
        const fence = FENCE_RE.exec(line);
        if (fence) {
            const marker = fence[1][0];
            const closing = new RegExp(`^[ \\t]*\\${marker}{3,}[ \\t]*$`);
            const body: string[] = [];
            i++;
            while (i < lines.length && !closing.test(lines[i])) { body.push(lines[i]); i++; }
            if (i < lines.length) i++; // the closing fence
            blocks.push({ kind: 'code', text: body.join('\n') });
            continue;
        }

        const heading = HEADING_RE.exec(line);
        if (heading) {
            blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
            i++; continue;
        }

        if (HR_RE.test(line)) { blocks.push({ kind: 'hr' }); i++; continue; }

        // blockquote — consecutive '>' lines, parsed recursively
        if (/^[ \t]*>/.test(line)) {
            const inner: string[] = [];
            while (i < lines.length && /^[ \t]*>/.test(lines[i])) {
                inner.push(lines[i].replace(/^[ \t]*>[ \t]?/, '')); i++;
            }
            blocks.push({ kind: 'quote', blocks: parseBlocks(inner) });
            continue;
        }

        // table — a row followed by a delimiter row
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

        // lists, with nesting
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
                    // A blank line ends the list unless the next line continues it.
                    const next = lines[i + 1];
                    if (!next || indentOf(next) < baseIndent
                        || !(BULLET_RE.test(next) || ORDERED_RE.test(next))) break;
                    i++; continue;
                }

                const deeper = indentOf(cur) > baseIndent;
                if (deeper) {
                    // Hand the whole indented run to a recursive parse and hang
                    // it under the item it belongs to.
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
                // A different kind of marker at the same level starts a new list.
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

        // paragraph — runs to a blank line or whatever starts the next block
        const para: string[] = [];
        while (i < lines.length && lines[i].trim() && !startsABlock(lines[i])) {
            para.push(lines[i].trim()); i++;
        }
        if (para.length) blocks.push({ kind: 'para', lines: para });
        else i++; // nothing consumed — never loop forever
    }

    return blocks;
}

/* ─────────────────────────────── render ─────────────────────────────── */

// Headings keep the portal's scale rather than the browser's, which would
// otherwise drop a 32px h1 into a 14px modal.
const HEADING_SIZE = [fontSize.xl, fontSize.lg, fontSize.base, fontSize.base, fontSize.md, fontSize.md];

function Blocks({ blocks, compact }: { blocks: Block[]; compact: boolean }) {
    const { t } = useTheme();
    const gap = compact ? space.xs : space.sm;

    return (
        <>
            {blocks.map((b, idx) => {
                // The block that ends the document sits flush, so a description
                // does not leave a stray gap at the bottom of its container.
                const mb = idx === blocks.length - 1 ? 0 : gap;

                switch (b.kind) {
                    case 'heading':
                        return (
                            <div
                                key={idx}
                                style={{
                                    color: t.text,
                                    fontSize: HEADING_SIZE[b.level - 1],
                                    fontWeight: b.level <= 2 ? 700 : 600,
                                    lineHeight: 1.35,
                                    margin: `${idx === 0 ? 0 : (compact ? space.sm : space.md)}px 0 ${mb}px`,
                                    ...(b.level <= 2 ? {
                                        borderBottom: `1px solid ${t.borderSubtle}`,
                                        paddingBottom: space.xs,
                                    } : {}),
                                }}
                            >
                                <InlineText text={b.text} />
                            </div>
                        );

                    case 'para':
                        return (
                            <div key={idx} style={{ color: t.text, lineHeight: 1.6, margin: `0 0 ${mb}px` }}>
                                {b.lines.map((l, li) => (
                                    <Fragment key={li}>
                                        {li > 0 && <br />}
                                        <InlineText text={l} />
                                    </Fragment>
                                ))}
                            </div>
                        );

                    case 'code':
                        return (
                            <pre
                                key={idx}
                                style={{
                                    background: t.surfaceSunken,
                                    border: `1px solid ${t.borderSubtle}`,
                                    borderRadius: radius.md,
                                    padding: `${space.sm}px ${space.md}px`,
                                    margin: `0 0 ${mb}px`,
                                    overflowX: 'auto',
                                    fontFamily: fontFamilyMono,
                                    fontSize: fontSize.sm,
                                    lineHeight: 1.55,
                                    color: t.text,
                                }}
                            >
                                <code>{b.text}</code>
                            </pre>
                        );

                    case 'quote':
                        return (
                            <div
                                key={idx}
                                style={{
                                    borderLeft: `3px solid ${alpha(t.accent, 0.5)}`,
                                    background: alpha(t.accent, 0.04),
                                    borderRadius: `0 ${radius.sm}px ${radius.sm}px 0`,
                                    padding: `${space.sm}px ${space.md}px`,
                                    margin: `0 0 ${mb}px`,
                                    color: t.textMuted,
                                }}
                            >
                                <Blocks blocks={b.blocks} compact />
                            </div>
                        );

                    case 'list': {
                        const hasTasks = b.items.some((it) => it.checked !== null);
                        const listStyle: CSSProperties = {
                            color: t.text,
                            margin: `0 0 ${mb}px`,
                            paddingInlineStart: hasTasks ? 0 : 22,
                            listStyle: hasTasks ? 'none' : undefined,
                            lineHeight: 1.6,
                        };
                        const children = b.items.map((it, ii) => (
                            <li key={ii} style={{ marginBottom: 2 }}>
                                {it.checked !== null && (
                                    <span
                                        aria-hidden
                                        style={{
                                            display: 'inline-block', width: '1.15em',
                                            color: it.checked ? t.success : t.textFaint,
                                            fontWeight: 700,
                                        }}
                                    >
                                        {it.checked ? '☑' : '☐'}
                                    </span>
                                )}
                                <span style={it.checked ? { color: t.textMuted } : undefined}>
                                    <InlineText text={it.content} />
                                </span>
                                {it.children.length > 0 && (
                                    <div style={{ marginTop: 2 }}>
                                        <Blocks blocks={it.children} compact />
                                    </div>
                                )}
                            </li>
                        ));
                        return b.ordered
                            ? <ol key={idx} start={b.start} style={listStyle}>{children}</ol>
                            : <ul key={idx} style={listStyle}>{children}</ul>;
                    }

                    case 'table':
                        return (
                            <div key={idx} style={{ overflowX: 'auto', margin: `0 0 ${mb}px` }}>
                                <table style={{
                                    borderCollapse: 'collapse', width: '100%',
                                    fontSize: fontSize.md, color: t.text,
                                }}>
                                    <thead>
                                        <tr>
                                            {b.head.map((h, hi) => (
                                                <th key={hi} style={{
                                                    textAlign: (b.align[hi] as CSSProperties['textAlign']) ?? 'left',
                                                    padding: `${space.xs}px ${space.sm}px`,
                                                    borderBottom: `1px solid ${t.border}`,
                                                    background: t.surfaceSunken,
                                                    color: t.textMuted,
                                                    fontSize: fontSize.sm,
                                                    fontWeight: 600,
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    <InlineText text={h} />
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {b.rows.map((r, ri) => (
                                            <tr key={ri}>
                                                {b.head.map((_, ci) => (
                                                    <td key={ci} style={{
                                                        textAlign: (b.align[ci] as CSSProperties['textAlign']) ?? 'left',
                                                        padding: `${space.xs}px ${space.sm}px`,
                                                        borderBottom: `1px solid ${t.borderSubtle}`,
                                                        verticalAlign: 'top',
                                                    }}>
                                                        <InlineText text={r[ci] ?? ''} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );

                    case 'hr':
                        return (
                            <div key={idx} style={{
                                borderTop: `1px solid ${t.borderSubtle}`,
                                margin: `${space.md}px 0`,
                            }} />
                        );
                }
            })}
        </>
    );
}

interface MarkdownProps {
    source?: string | null;
    /** Tighter vertical rhythm, for a description inside a card. */
    compact?: boolean;
    style?: CSSProperties;
    className?: string;
}

/** Renders a Markdown string with the portal's typography. */
export default function Markdown({ source, compact = false, style, className }: MarkdownProps) {
    if (!source || !source.trim()) return null;
    const blocks = parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'));
    return (
        <div className={className} style={{ wordBreak: 'break-word', ...style }}>
            <Blocks blocks={blocks} compact={compact} />
        </div>
    );
}

/** A truncated single-line preview with the Markdown taken off. */
export function MarkdownPreview({ source, limit = 72, style }: {
    source?: string | null; limit?: number; style?: CSSProperties;
}) {
    const text = markdownToPlainText(source);
    if (!text) return null;
    return (
        <span style={style}>
            {text.length > limit ? `${text.slice(0, limit)}…` : text}
        </span>
    );
}
