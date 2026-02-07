"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useChatStore } from "@/stores/chatStore";

export default function Header() {
  const { model, setModel, connected } = useSettingsStore();
  const usage = useChatStore((s) => s.usage);

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
