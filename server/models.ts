/**
 * Anthropic API 모델 목록 조회 및 최신 모델 자동 감지
 */

interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
}

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
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1시간

function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null;
}

async function fetchFromApi(apiKey: string): Promise<AnthropicModel[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

function pickLatest(models: AnthropicModel[]): ModelInfo[] {
  const result: ModelInfo[] = [];

  for (const family of Object.keys(FAMILY_LABELS)) {
    const matching = models.filter((m) => m.id.includes(family));
    if (matching.length === 0) continue;

    // created_at 기준 최신순 정렬
    matching.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const latest = matching[0];

    result.push({
      alias: family,
      label: `${latest.display_name} (${FAMILY_LABELS[family]})`,
      modelId: latest.id,
    });
  }

  return result.length > 0 ? result : FALLBACK_MODELS;
}

/** 모델 목록 (캐시됨, API 실패 시 폴백) */
export async function getModelList(): Promise<ModelInfo[]> {
  if (cachedModels && Date.now() - cacheTime < CACHE_TTL) {
    return cachedModels;
  }

  const apiKey = getApiKey();
  if (!apiKey) return FALLBACK_MODELS;

  try {
    const models = await fetchFromApi(apiKey);
    cachedModels = pickLatest(models);
    cacheTime = Date.now();
    console.log("[models] 최신 모델 감지:", cachedModels.map((m) => `${m.alias}→${m.modelId}`).join(", "));
    return cachedModels;
  } catch (err) {
    console.error("[models] API 호출 실패, 폴백 사용:", err);
    return FALLBACK_MODELS;
  }
}

/** alias("opus")를 실제 모델 ID("claude-opus-4-6")로 변환 */
export async function resolveModelAlias(alias: string): Promise<string> {
  const models = await getModelList();
  const found = models.find((m) => m.alias === alias);
  return found ? found.modelId : alias;
}
