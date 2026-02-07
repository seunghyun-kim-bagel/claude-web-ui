"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useChatStore } from "@/stores/chatStore";
import { useState } from "react";

export default function Header() {
  const { model, setModel, cwd, setCwd, connected } = useSettingsStore();
  const usage = useChatStore((s) => s.usage);
  const [cwdInput, setCwdInput] = useState(cwd);
  const [editing, setEditing] = useState(false);

  const handleCwdSubmit = async () => {
    try {
      const res = await fetch("http://localhost:3001/api/directories/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: cwdInput }),
      });
      const data = await res.json();
      if (data.valid) {
        setCwd(cwdInput);
        setEditing(false);
      } else {
        alert("유효하지 않은 경로입니다.");
      }
    } catch {
      alert("서버 연결 실패");
    }
  };

  return (
    <header className="h-12 border-b border-zinc-700 bg-zinc-900 flex items-center px-4 gap-4 shrink-0">
      <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />

      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="bg-zinc-800 text-zinc-200 text-sm border border-zinc-600 rounded px-2 py-1"
      >
        <option value="opus">Opus (최상위)</option>
        <option value="sonnet">Sonnet (기본)</option>
        <option value="haiku">Haiku (빠름)</option>
      </select>

      {editing ? (
        <div className="flex gap-1 flex-1">
          <input
            value={cwdInput}
            onChange={(e) => setCwdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCwdSubmit()}
            className="flex-1 bg-zinc-800 text-zinc-200 text-sm border border-zinc-600 rounded px-2 py-1"
            autoFocus
          />
          <button
            onClick={handleCwdSubmit}
            className="text-sm bg-blue-600 text-white px-2 py-1 rounded"
          >
            확인
          </button>
          <button
            onClick={() => { setEditing(false); setCwdInput(cwd); }}
            className="text-sm bg-zinc-700 text-zinc-300 px-2 py-1 rounded"
          >
            취소
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-zinc-400 hover:text-zinc-200 truncate max-w-md"
          title={cwd}
        >
          {cwd}
        </button>
      )}

      {usage.totalCostUsd > 0 && (
        <div className="ml-auto text-xs text-zinc-500 flex gap-3 shrink-0">
          <span>입력: {usage.inputTokens.toLocaleString()}</span>
          <span>출력: {usage.outputTokens.toLocaleString()}</span>
          <span>캐시: {usage.cacheReadTokens.toLocaleString()}</span>
          <span>비용: ${usage.totalCostUsd.toFixed(4)}</span>
        </div>
      )}
    </header>
  );
}
