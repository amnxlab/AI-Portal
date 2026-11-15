/* ═══════════════════════════════════════════════════════════════════════
   Markdown helpers that are not components.

   Separate from `components/Markdown.tsx` because a module exporting a mix
   of components and plain functions defeats fast refresh: the whole module
   reloads instead of the component re-rendering.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The same text with the Markdown taken off, for one-line previews.
 *
 * A card showing the first 60 characters of a description cannot render a
 * heading or a list in that space, but it should not show `## Goal` and
 * `**blocked**` either. This strips the syntax and keeps the words.
 */
export function markdownToPlainText(source?: string | null): string {
    if (!source) return '';
    return source
        .replace(/\r\n?/g, '\n')
        .replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '')               // fence lines, keeping the code
        .replace(/`([^`\n]+)`/g, '$1')                            // inline code
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                 // image → alt
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                  // link → label
        .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')          // autolink
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')                     // heading marks
        .replace(/^[ \t]*>[ \t]?/gm, '')                          // quote marks
        .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')     // rules
        // A table's delimiter row carries no words, and the pipes are
        // flattened further down, so it would otherwise survive as '--- ---'.
        .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
        .replace(/^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+/gm, (_m, c: string) => (c.toLowerCase() === 'x' ? '✓ ' : '• '))
        .replace(/^[ \t]*[-*+][ \t]+/gm, '• ')                    // bullets
        .replace(/^[ \t]*(\d{1,9})[.)][ \t]+/gm, '$1. ')          // ordered
        .replace(/(\*\*\*|___)(\S[\s\S]*?)\1/g, '$2')
        .replace(/(\*\*|__)(\S[\s\S]*?)\1/g, '$2')
        .replace(/(^|[^\w*])\*(\S[\s\S]*?)\*(?![\w*])/g, '$1$2')
        .replace(/(^|[^\w_])_(\S[\s\S]*?)_(?![\w_])/g, '$1$2')
        .replace(/~~(\S[\s\S]*?)~~/g, '$1')
        .replace(/\|/g, ' ')                                      // table pipes
        .replace(/[ \t]+/g, ' ')
        .split('\n').map((l) => l.trim()).filter(Boolean).join(' · ')
        .trim();
}
