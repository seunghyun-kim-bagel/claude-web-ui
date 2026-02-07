"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { useChatStore } from "@/stores/chatStore";

interface Props {
  onSend: (message: string) => void;
  onAbort: () => void;
}

export default function MessageInput({ onSend, onAbort }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const queuedCount = useChatStore((s) => s.queuedMessages.length);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  };

  return (
    <div className="border-t border-zinc-700 bg-zinc-900 p-4">
      {queuedCount > 0 && (
        <div className="text-xs text-amber-400 text-center mb-2">
          {queuedCount}개 메시지 대기 중 — 현재 응답 완료 후 자동 전송됩니다
        </div>
      )}
      <div className="flex gap-2 items-end max-w-4xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={isStreaming ? "메시지를 입력하면 대기열에 추가됩니다..." : "메시지를 입력하세요... (Shift+Enter: 줄바꿈)"}
          className="flex-1 resize-none bg-zinc-800 text-zinc-100 border border-zinc-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 min-h-[48px] max-h-[200px]"
          rows={1}
        />
        <div className="flex gap-1">
          {isStreaming && (
            <button
              onClick={onAbort}
              className="px-3 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors text-sm"
            >
              중단
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className={`px-4 py-3 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg font-medium transition-colors ${
              isStreaming
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isStreaming ? "대기" : "전송"}
          </button>
        </div>
      </div>
    </div>
  );
}
