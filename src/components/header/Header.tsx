"use client";

import { useEffect, useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useChatStore } from "@/stores/chatStore";

interface ModelInfo {
  alias: string;
  label: string;
  modelId: string;
}

const FALLBACK_MODELS: ModelInfo[] = [
  { alias: "opus", label: "Opus (최상위)", modelId: "opus" },
  { alias: "sonnet", label: "Sonnet (기본)", modelId: "sonnet" },
  { alias: "haiku", label: "Haiku (빠름)", modelId: "haiku" },
];

export default function Header() {
  const { model, setModel, connected } = useSettingsStore();
  const usage = useChatStore((s) => s.usage);
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);

  useEffect(() => {
    fetch("http://localhost:3001/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (data.models?.length) setModels(data.models);
      })
      .catch(() => {});
  }, []);

  return (
    <header className="h-12 border-b border-zinc-700 bg-zinc-900 flex items-center px-4 gap-4 shrink-0">
      <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />

      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="bg-zinc-800 text-zinc-200 text-sm border border-zinc-600 rounded px-2 py-1"
      >
        {models.map((m) => (
          <option key={m.alias} value={m.alias}>{m.label}</option>
        ))}
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
