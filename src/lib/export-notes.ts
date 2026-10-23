import type { UserAnnotation } from '~types/user-data';
import { formatDate, formatDateTime } from '@kernel/locale/format';

/** Markdown blockquote; every line needs the `>` prefix or a multi-line highlight breaks out of the quote. */
const toBlockquote = (text: string): string => `> ${text.replace(/\r?\n/g, '\n> ')}`;

export const exportNotesToMarkdown = (bookTitle: string, annotations: UserAnnotation[]) => {
    let md = `# Notes from ${bookTitle}\n\n`;
    md += `*Exported from Versicle on ${formatDate(Date.now())}*\n\n---\n\n`;

    annotations.forEach(ann => {
        md += `${toBlockquote(ann.text)}\n\n`;
        if (ann.note) {
            md += `**Note:** ${ann.note}\n\n`;
        }
        md += `*${formatDateTime(ann.created)}*\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${bookTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_notes.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export const copyAnnotationAsMarkdown = async (ann: UserAnnotation) => {
    let md = toBlockquote(ann.text);
    if (ann.note) md += `\n\n**Note:** ${ann.note}`;
    await navigator.clipboard.writeText(md);
};
