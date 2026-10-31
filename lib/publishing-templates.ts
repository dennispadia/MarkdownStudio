export const publishingTemplates = [
  { id: 'callout-note', label: 'Note', color: 'note', markdown: '> [!NOTE]\n> Add information readers should notice.' },
  { id: 'callout-tip', label: 'Tip', color: 'tip', markdown: '> [!TIP]\n> Add a useful suggestion.' },
  { id: 'callout-important', label: 'Important', color: 'important', markdown: '> [!IMPORTANT]\n> Add essential information.' },
  { id: 'callout-caution', label: 'Caution', color: 'caution', markdown: '> [!CAUTION]\n> Explain a risk and how to avoid it.' },
  { id: 'callout-warning', label: 'Warning', color: 'warning', markdown: '> [!WARNING]\n> Explain a serious risk and the precautions to take.' },
  { id: 'publishing-tabs', label: 'Tabbed examples', color: '', markdown: '# [First example](#tab/first)\n\nContent for the first example.\n\n# [Second example](#tab/second)\n\nContent for the second example.\n\n---' },
  { id: 'publishing-selector', label: 'Variant selector', color: '', markdown: ':::selector title="Choose an option"\n- [First option](#variant/first)\n- [Second option](#variant/second)\n:::selector-end\n\n:::zone pivot="first"\nContent for the first option.\n:::zone-end\n\n:::zone pivot="second"\nContent for the second option.\n:::zone-end' },
  { id: 'publishing-steps', label: 'Structured steps', color: '', markdown: ':::steps\n1. Describe the first step.\n2. Describe the next step.\n:::steps-end' },
  { id: 'publishing-image', label: 'Image with description…', color: '', markdown: '' },
  { id: 'publishing-metadata', label: 'Document metadata', color: '', markdown: '---\ntitle: Document title\ndescription: A short description of this document.\n---' },
  { id: 'publishing-include', label: 'Local include', color: '', markdown: '[!INCLUDE [Shared content](./includes/shared.md)]' },
] as const;

export function publishingTemplateMarkdown(id: string, selection = ''): string | undefined {
  const template = publishingTemplates.find(item => item.id === id);
  if (!template) return undefined;
  if (!selection) return template.markdown;
  if (id.startsWith('callout-')) {
    return `> [!${id.slice('callout-'.length).toUpperCase()}]\n${selection.replace(/\r\n/g, '\n').split('\n').map(line => `> ${line}`).join('\n')}`;
  }
  if (id === 'publishing-tabs') return template.markdown.replace('Content for the first example.', () => selection);
  if (id === 'publishing-selector') return template.markdown.replace('Content for the first option.', () => selection);
  if (id === 'publishing-steps') return `:::steps\n${selection}\n:::steps-end`;
  return template.markdown;
}
