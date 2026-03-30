import type { MarkdownToJSX } from 'markdown-to-jsx';
import type { ReactNode } from 'react';

const Table = ({ children, ...props }: { children: ReactNode }) => (
  <div className="overflow-x-auto my-2">
    <table className="text-[12px] w-full border-collapse" {...props}>{children}</table>
  </div>
);

/** Shared markdown component overrides for consistent styling */
export const markdownOverrides: MarkdownToJSX.Overrides = {
  p: { component: 'p', props: { className: 'mb-2 last:mb-0' } },
  strong: { component: 'strong', props: { className: 'font-semibold' } },
  em: { component: 'em', props: { className: 'text-accent' } },
  ul: { component: 'ul', props: { className: 'list-disc pl-4 mb-2 space-y-0.5' } },
  ol: { component: 'ol', props: { className: 'list-decimal pl-4 mb-2 space-y-0.5' } },
  li: { component: 'li', props: { className: 'text-[13px]' } },
  h1: { component: 'h3', props: { className: 'text-sm font-semibold mt-3 mb-1' } },
  h2: { component: 'h3', props: { className: 'text-sm font-semibold mt-3 mb-1' } },
  h3: { component: 'h4', props: { className: 'text-[13px] font-semibold mt-2 mb-1' } },
  pre: { component: 'pre', props: { className: 'bg-muted rounded-lg p-3 my-2 text-[11px] overflow-x-auto' } },
  code: { component: 'code', props: { className: 'bg-muted rounded px-1 py-0.5 text-[12px] font-mono' } },
  table: { component: Table as unknown as React.ComponentType },
  thead: { component: 'thead', props: { className: '' } },
  tbody: { component: 'tbody', props: { className: '' } },
  tr: { component: 'tr', props: { className: 'border-b border-border/30 last:border-0' } },
  th: { component: 'th', props: { className: 'text-left py-1.5 px-2 border-b border-border font-medium text-[11px] bg-muted/30' } },
  td: { component: 'td', props: { className: 'py-1.5 px-2 tabular-nums' } },
  hr: { component: 'hr', props: { className: 'my-3 border-border/30' } },
  a: { component: 'a', props: { className: 'text-accent underline', target: '_blank', rel: 'noopener' } },
  blockquote: { component: 'blockquote', props: { className: 'border-l-2 border-accent/30 pl-3 my-2 text-muted-foreground' } },
};
