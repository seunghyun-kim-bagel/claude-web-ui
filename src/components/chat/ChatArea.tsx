"use client";

import { useEffect, useRef, useCallback, useState, memo } from "react";
import { useChatStore, ChatMessage, ContentBlock, ToolUseBlock } from "@/stores/chatStore";
import MarkdownRenderer from "./MarkdownRenderer";
import ToolUsePanel from "./ToolUsePanel";
import ToolUseGroup from "./ToolUseGroup";

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
  // 연속된 tool_use 블록을 그룹으로 묶기
  const elements: React.ReactNode[] = [];
  let toolGroup: ToolUseBlock[] = [];

  const flushGroup = () => {
    if (toolGroup.length === 0) return;
    if (toolGroup.length === 1) {
      elements.push(
        <ToolUsePanel key={`t-${toolGroup[0].id}`} tool={toolGroup[0]} result={toolResults.get(toolGroup[0].id)} />
      );
    } else {
      elements.push(
        <ToolUseGroup key={`g-${toolGroup[0].id}`} tools={[...toolGroup]} toolResults={toolResults} />
      );
    }
    toolGroup = [];
  };

  for (const block of content) {
    if (block.type === "tool_use") {
      toolGroup.push(block as ToolUseBlock);
    } else {
      flushGroup();
      if (block.type === "text") {
        elements.push(<MarkdownRenderer key={`m-${elements.length}`} content={block.text} />);
      }
    }
  }
  flushGroup();

  return elements;
}

interface BubbleProps {
  msg: ChatMessage;
  toolResults: Map<string, ToolResult>;
  onRewind?: () => void;
  showRewind?: boolean;
}

const MessageBubble = memo(function MessageBubble({ msg, toolResults, onRewind, showRewind }: BubbleProps) {
  if (msg.role === "user" && msg.content.some((b) => b.type === "tool_result")) {
    return null;
  }

  const isUser = msg.role === "user";

  return (
    <div className={`group max-w-4xl mx-auto ${isUser ? "flex justify-end items-start gap-1" : ""}`}>
      {isUser && showRewind && (
        <button
          onClick={() => {
            if (window.confirm("이 메시지 이후의 대화를 모두 삭제합니다. 계속하시겠습니까?")) {
              onRewind?.();
            }
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-2 p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700"
          title="이 시점으로 되감기"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      )}
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

interface ChatAreaProps {
  onRewind?: (messageId: string, userTurnIndex: number) => Promise<boolean>;
}

export default function ChatArea({ onRewind }: ChatAreaProps) {
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

  // 유저가 직접 입력한 메시지(tool_result 아닌)의 턴 인덱스 매핑
  const userTurnMap = new Map<string, number>();
  let lastUserInputId: string | null = null;
  let turnIdx = 0;
  for (const msg of messages) {
    const isUserInput = msg.role === "user" && msg.content.some((b) => b.type === "text") && !msg.content.some((b) => b.type === "tool_result");
    if (isUserInput) {
      userTurnMap.set(msg.id, turnIdx);
      lastUserInputId = msg.id;
      turnIdx++;
    }
  }

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

        {visibleMessages.map((msg) => {
          const turnIndex = userTurnMap.get(msg.id);
          const isUserInput = turnIndex !== undefined;
          const isLastUserInput = msg.id === lastUserInputId;
          const canRewind = isUserInput && !isLastUserInput && !isStreaming && !!onRewind;

          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              toolResults={toolResults}
              showRewind={canRewind}
              onRewind={canRewind ? () => onRewind(msg.id, turnIndex) : undefined}
            />
          );
        })}

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
