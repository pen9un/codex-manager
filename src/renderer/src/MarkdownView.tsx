import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
export function MarkdownView({ source }: { source: string }): React.JSX.Element {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  return <article className="markdown-preview"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children, ...props }) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a> : <span {...props}>{children}</span> }}>{body}</Markdown></article>
}
