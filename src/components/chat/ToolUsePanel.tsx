"use client";

import { useState } from "react";
import { ToolUseBlock } from "@/stores/chatStore";

interface Props {
  tool: ToolUseBlock;
  result?: {
    content: string;
    is_error: boolean;
    stdout?: string;
    stderr?: string;
  };
}

export default function ToolUsePanel({ tool, result }: Props) {
  const [expanded, setExpanded] = useState(false);

  const summary = tool.input.command
    || tool.input.file_path
    || tool.input.pattern
    || tool.input.query
    || JSON.stringify(tool.input).substring(0, 80);

  return (
    <div className="my-2 border border-zinc-600 rounded-lg overflow-hidden text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 bg-zinc-700/50 px-3 py-2 hover:bg-zinc-700 transition-colors text-left"
      >
        <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>
          &#9654;
        </span>
        <span className="font-mono text-blue-300">{tool.name}</span>
        <span className="text-zinc-400 truncate flex-1">{String(summary)}</span>
        {result && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${result.is_error ? "bg-red-900 text-red-300" : "bg-green-900 text-green-300"}`}>
            {result.is_error ? "실패" : "완료"}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-zinc-600">
          <div className="px-3 py-2 bg-zinc-800">
            <div className="text-xs text-zinc-500 mb-1">입력</div>
            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {result && (
            <div className="px-3 py-2 bg-zinc-800/50 border-t border-zinc-700">
              <div className="text-xs text-zinc-500 mb-1">결과</div>
              <pre className="text-xs font-mono text-zinc-400 whitespace-pre-wrap break-all max-h-[400px] overflow-y-auto">
                {(result.stdout || result.content || "").substring(0, 5000)}
                {(result.stdout || result.content || "").length > 5000 && "\n... (출력 생략)"}
              </pre>
              {result.stderr && (
                <pre className="text-xs font-mono text-red-400 whitespace-pre-wrap break-all mt-1">
                  {result.stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
