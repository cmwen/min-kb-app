import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
  const className = ["markdown-content", props.className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table({ children, ...tableProps }) {
            return (
              <div className="markdown-table-scroll">
                <table {...tableProps}>{children}</table>
              </div>
            );
          },
        }}
      >
        {props.children}
      </ReactMarkdown>
    </div>
  );
}
