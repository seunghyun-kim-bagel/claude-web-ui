/**
 * Claude CLI를 통한 모델 감지
 *
 * CLI 자체가 alias → 최신 모델 ID 매핑을 처리하므로
 * 서버 시작 시 CLI에 짧은 요청을 보내 실제 모델 ID를 확인한다.
 */

import { execSync } from "child_process";

export interface ModelInfo {
  alias: string;
  label: string;
  modelId: string;
}

const FAMILY_LABELS: Record<string, string> = {
  opus: "최상위",
  sonnet: "기본",
  haiku: "빠름",
};

const FALLBACK_MODELS: ModelInfo[] = [
  { alias: "opus", label: "Opus (최상위)", modelId: "opus" },
  { alias: "sonnet", label: "Sonnet (기본)", modelId: "sonnet" },
  { alias: "haiku", label: "Haiku (빠름)", modelId: "haiku" },
];

let cachedModels: ModelInfo[] | null = null;

function probeModel(alias: string): string | null {
  try {
    const out = execSync(
      `claude -p --model ${alias} --output-format json --max-budget-usd 0.001 "hi"`,
      { timeout: 30000, stdio: ["ignore", "pipe", "ignore"], shell: true }
    ).toString("utf-8");
    const json = JSON.parse(out);
    const usage = json.modelUsage;
    if (usage) {
      const modelId = Object.keys(usage)[0];
      if (modelId) return modelId;
    }
  } catch {
    // 무시
  }
  return null;
}

function formatLabel(modelId: string, alias: string): string {
  // claude-opus-4-6 → Opus 4.6
  // claude-sonnet-4-5-20250929 → Sonnet 4.5
  const name = modelId
    .replace(/^claude-/, "")
    .replace(/-\d{8,}$/, "")          // 날짜 접미사 제거
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/^(\w)/, (c) => c.toUpperCase());
  return `${name} (${FAMILY_LABELS[alias]})`;
}

/** 서버 시작 시 한 번 호출하여 모델 감지 (백그라운드) */
export async function detectModels(): Promise<void> {
  console.log("[models] CLI를 통해 최신 모델 감지 중...");
  const results: ModelInfo[] = [];

  for (const alias of Object.keys(FAMILY_LABELS)) {
    const modelId = probeModel(alias);
    if (modelId) {
      results.push({
        alias,
        label: formatLabel(modelId, alias),
        modelId,
      });
      console.log(`[models]   ${alias} → ${modelId}`);
    } else {
      results.push(FALLBACK_MODELS.find((m) => m.alias === alias)!);
      console.log(`[models]   ${alias} → 감지 실패, 폴백 사용`);
    }
  }

  cachedModels = results;
}

/** 모델 목록 반환 */
export function getModelList(): ModelInfo[] {
  return cachedModels || FALLBACK_MODELS;
}

/** alias("opus")를 실제 모델 ID("claude-opus-4-6")로 변환 */
export function resolveModelAlias(alias: string): string {
  const models = getModelList();
  const found = models.find((m) => m.alias === alias);
  return found ? found.modelId : alias;
}
