import type { UserAnnotation } from '../types/db';

export const exportNotesToMarkdown = (bookTitle: string, annotations: UserAnnotation[]) => {
    let md = `# Notes from ${bookTitle}\n\n`;
    md += `*Exported from Versicle on ${new Date().toLocaleDateString()}*\n\n---\n\n`;

    annotations.forEach(ann => {
        md += `> ${ann.text}\n\n`;
        if (ann.note) {
            md += `**Note:** ${ann.note}\n\n`;
        }
        md += `*${new Date(ann.created).toLocaleString()}*\n\n---\n\n`;
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
    let md = `> ${ann.text}`;
    if (ann.note) md += `\n\n**Note:** ${ann.note}`;
    await navigator.clipboard.writeText(md);
};
