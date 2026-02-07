"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Props {
  content: string;
}

export default function MarkdownRenderer({ content }: Props) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
      prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700
      prose-code:text-blue-300 prose-code:before:content-none prose-code:after:content-none
      prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
      prose-table:border-collapse prose-th:border prose-th:border-zinc-600 prose-th:px-3 prose-th:py-1
      prose-td:border prose-td:border-zinc-700 prose-td:px-3 prose-td:py-1
      break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
