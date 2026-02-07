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

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
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
      <div className="flex gap-2 items-end max-w-4xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="메시지를 입력하세요... (Shift+Enter: 줄바꿈)"
          className="flex-1 resize-none bg-zinc-800 text-zinc-100 border border-zinc-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 min-h-[48px] max-h-[200px]"
          rows={1}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            중단
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg font-medium transition-colors"
          >
            전송
          </button>
        )}
      </div>
    </div>
  );
}
