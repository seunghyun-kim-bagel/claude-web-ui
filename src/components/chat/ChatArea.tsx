"use client";

import { useEffect, useRef, useCallback, useState, memo } from "react";
import { useChatStore, ChatMessage, ContentBlock, ToolUseBlock } from "@/stores/chatStore";
import MarkdownRenderer from "./MarkdownRenderer";
import ToolUsePanel from "./ToolUsePanel";

const PAGE_SIZE = 50;

interface ToolResult {
  content: string;
  is_error: boolean;
  stdout?: string;
  stderr?: string;
}

function findToolResult(
  toolUseId: string,
  messages: ChatMessage[],
  currentIndex: number
): ToolResult | undefined {
  for (let i = currentIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user" && msg.content) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
          return {
            content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
            is_error: block.is_error,
            stdout: msg.toolUseResult?.stdout,
            stderr: msg.toolUseResult?.stderr,
          };
        }
      }
    }
    if (msg.role === "assistant") break;
  }
  return undefined;
}

function renderAssistantContent(
  content: ContentBlock[],
  toolResults: Map<string, ToolResult>
) {
  return content.map((block, i) => {
    if (block.type === "text") {
      return <MarkdownRenderer key={i} content={block.text} />;
    }
    if (block.type === "tool_use") {
      const tool = block as ToolUseBlock;
      return <ToolUsePanel key={i} tool={tool} result={toolResults.get(tool.id)} />;
    }
    return null;
  });
}

interface BubbleProps {
  msg: ChatMessage;
  toolResults: Map<string, ToolResult>;
}

const MessageBubble = memo(function MessageBubble({ msg, toolResults }: BubbleProps) {
  if (msg.role === "user" && msg.content.some((b) => b.type === "tool_result")) {
    return null;
  }

  const isUser = msg.role === "user";

  return (
    <div className={`max-w-4xl mx-auto ${isUser ? "flex justify-end" : ""}`}>
      <div
        className={`rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white max-w-[80%]"
            : "bg-zinc-800 text-zinc-100 w-full"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">
            {msg.content.map((b, i) => (b.type === "text" ? <span key={i}>{b.text}</span> : null))}
          </div>
        ) : (
          renderAssistantContent(msg.content, toolResults)
        )}
      </div>
    </div>
  );
});

/** 메시지별 tool_use 결과를 미리 계산 */
function buildToolResultMap(messages: ChatMessage[]): Map<string, ToolResult> {
  const map = new Map<string, ToolResult>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        const tool = block as ToolUseBlock;
        const result = findToolResult(tool.id, messages, i);
        if (result) map.set(tool.id, result);
      }
    }
  }
  return map;
}

export default function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 새 세션 전환 시 visibleCount 리셋
  const sessionId = useChatStore((s) => s.sessionId);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [sessionId]);

  const checkNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingText]);

  const toolResults = buildToolResultMap(messages);
  const hasMore = messages.length > visibleCount;
  const visibleMessages = hasMore ? messages.slice(messages.length - visibleCount) : messages;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div ref={scrollContainerRef} onScroll={checkNearBottom} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-zinc-500">
            메시지를 입력하여 대화를 시작하세요.
          </div>
        )}

        {hasMore && (
          <div className="max-w-4xl mx-auto">
            <button
              onClick={loadMore}
              className="w-full text-center text-sm text-zinc-400 hover:text-zinc-200 py-2 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              이전 메시지 더 보기 ({messages.length - visibleCount}개 남음)
            </button>
          </div>
        )}

        {visibleMessages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            toolResults={toolResults}
          />
        ))}

        {isStreaming && !streamingText && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-zinc-800 text-zinc-100 rounded-lg px-4 py-3 w-full flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
              <span className="ml-2 text-sm text-zinc-400">응답을 생성하고 있습니다...</span>
            </div>
          </div>
        )}

        {streamingText && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-zinc-800 text-zinc-100 rounded-lg px-4 py-3 w-full">
              <MarkdownRenderer content={streamingText} />
              <span className="inline-block w-2 h-4 bg-blue-400 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

    </div>
  );
}
