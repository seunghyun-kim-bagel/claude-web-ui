"use client";

import { useState } from "react";
import { ChatMessage, ToolUseBlock } from "@/stores/chatStore";
import ToolUsePanel from "./ToolUsePanel";

interface ToolResult {
  content: string;
  is_error: boolean;
  stdout?: string;
  stderr?: string;
}

interface Props {
  messages: ChatMessage[];
  toolResults: Map<string, ToolResult>;
}

export default function ToolActivityGroup({ messages, toolResults }: Props) {
  const [expanded, setExpanded] = useState(false);

  const allTools: ToolUseBlock[] = [];
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use") {
        allTools.push(block as ToolUseBlock);
      }
    }
  }

  if (allTools.length === 0) return null;

  const counts = new Map<string, number>();
  let successCount = 0;
  let failCount = 0;
  for (const tool of allTools) {
    counts.set(tool.name, (counts.get(tool.name) || 0) + 1);
    const result = toolResults.get(tool.id);
    if (result) {
      if (result.is_error) failCount++;
      else successCount++;
    }
  }

  const summary = Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");

  return (
    <div className="max-w-4xl mx-auto">
      <div className="border border-zinc-600 rounded-lg overflow-hidden text-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 bg-zinc-700/50 px-3 py-2 hover:bg-zinc-700 transition-colors text-left"
        >
          <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>
            &#9654;
          </span>
          <span className="text-zinc-300 shrink-0">
            도구 실행 {allTools.length}건
          </span>
          <span className="text-zinc-500 truncate flex-1">{summary}</span>
          <div className="flex gap-1 shrink-0">
            {successCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-green-900 text-green-300">
                {successCount} 완료
              </span>
            )}
            {failCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-300">
                {failCount} 실패
              </span>
            )}
          </div>
        </button>

        {expanded && (
          <div className="border-t border-zinc-600 bg-zinc-800/30 px-2 py-1 space-y-0.5">
            {messages.map((msg) => {
              const textBlocks = msg.content.filter(
                (b) => b.type === "text" && b.text.trim()
              );
              const toolBlocks = msg.content.filter(
                (b): b is ToolUseBlock => b.type === "tool_use"
              );

              return (
                <div key={msg.id}>
                  {textBlocks.map((b, i) => (
                    <div
                      key={i}
                      className="text-xs text-zinc-400 px-1 py-1 italic"
                    >
                      {b.type === "text" ? b.text : ""}
                    </div>
                  ))}
                  {toolBlocks.map((tool) => (
                    <ToolUsePanel
                      key={tool.id}
                      tool={tool}
                      result={toolResults.get(tool.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
