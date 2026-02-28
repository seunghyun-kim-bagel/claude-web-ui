"use client";

import { useState } from "react";
import { ToolUseBlock } from "@/stores/chatStore";

interface ToolResult {
  content: string;
  is_error: boolean;
}

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

const INTERACTIVE_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "EnterPlanMode"]);

export function isInteractiveTool(name: string): boolean {
  return INTERACTIVE_TOOL_NAMES.has(name);
}

interface Props {
  tool: ToolUseBlock;
  result?: ToolResult;
  onSendMessage?: (message: string) => void;
}

export default function InteractiveToolPanel({ tool, result, onSendMessage }: Props) {
  switch (tool.name) {
    case "AskUserQuestion":
      return <AskUserQuestionPanel tool={tool} result={result} onSendMessage={onSendMessage} />;
    case "EnterPlanMode":
      return <EnterPlanModePanel result={result} onSendMessage={onSendMessage} />;
    case "ExitPlanMode":
      return <ExitPlanModePanel result={result} onSendMessage={onSendMessage} />;
    default:
      return null;
  }
}

// --- AskUserQuestion ---

function AskUserQuestionPanel({ tool, result, onSendMessage }: Props) {
  const input = tool.input as { questions?: Question[] };
  const questions = input.questions || [];
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [customText, setCustomText] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [sent, setSent] = useState(false);

  let autoAnswers: Record<string, string> = {};
  if (result?.content) {
    try {
      const parsed = JSON.parse(result.content);
      if (parsed.answers) autoAnswers = parsed.answers;
    } catch {
      // plain text
    }
  }

  const handleOptionClick = (questionText: string, label: string, multiSelect: boolean) => {
    if (sent) return;
    if (!multiSelect && questions.length <= 1) {
      onSendMessage?.(label);
      setSent(true);
      return;
    }
    if (multiSelect) {
      setSelections((prev) => {
        const current = prev[questionText] || [];
        const idx = current.indexOf(label);
        return {
          ...prev,
          [questionText]: idx >= 0 ? current.filter((_, i) => i !== idx) : [...current, label],
        };
      });
    } else {
      setSelections((prev) => ({ ...prev, [questionText]: [label] }));
    }
  };

  const handleSubmitAll = () => {
    if (sent) return;
    const parts: string[] = [];
    for (const q of questions) {
      const sel = selections[q.question];
      if (sel && sel.length > 0) {
        parts.push(sel.join(", "));
      }
    }
    if (parts.length > 0) {
      onSendMessage?.(parts.join("\n"));
      setSent(true);
    }
  };

  const handleSubmitCustom = () => {
    if (!customText.trim() || sent) return;
    onSendMessage?.(customText.trim());
    setSent(true);
  };

  const needsSubmitButton = questions.length > 1 || questions.some((q) => q.multiSelect);

  return (
    <div className="my-2 border border-violet-500/40 rounded-lg overflow-hidden">
      <div className="bg-violet-900/20 px-3 py-2 flex items-center gap-2 border-b border-violet-500/20">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400 shrink-0">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
        <span className="text-violet-300 font-medium text-sm">Claude 질문</span>
        {(!!result || sent) && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-800/60 text-violet-300 ml-auto">
            {sent ? "응답 전송됨" : "자동 응답됨"}
          </span>
        )}
      </div>
      <div className="p-3 space-y-4">
        {questions.map((q, qi) => {
          const sel = selections[q.question] || [];
          const autoAnswer = autoAnswers[q.question];
          return (
            <div key={qi}>
              {q.header && (
                <span className="text-xs text-violet-400 font-medium mb-0.5 block">{q.header}</span>
              )}
              <p className="text-zinc-200 text-sm mb-2">{q.question}</p>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => {
                  const isAutoSelected = autoAnswer === opt.label;
                  const isUserSelected = sel.includes(opt.label);
                  const highlighted = isAutoSelected || isUserSelected;
                  const isMulti = !!q.multiSelect;
                  return (
                    <button
                      key={oi}
                      disabled={sent}
                      onClick={() => handleOptionClick(q.question, opt.label, isMulti)}
                      className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                        highlighted
                          ? "border-violet-500 bg-violet-900/40 text-violet-200"
                          : sent
                          ? "border-zinc-700 text-zinc-500 cursor-not-allowed"
                          : "border-zinc-600 hover:border-violet-400 hover:bg-zinc-700/50 text-zinc-300"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 w-4 h-4 ${isMulti ? "rounded-sm" : "rounded-full"} border-2 flex items-center justify-center shrink-0 ${
                            highlighted ? "border-violet-400" : "border-zinc-500"
                          }`}
                        >
                          {highlighted && (
                            <span className={`${isMulti ? "w-2 h-2 rounded-sm" : "w-2 h-2 rounded-full"} bg-violet-400`} />
                          )}
                        </span>
                        <div className="min-w-0">
                          <span className="font-medium">{opt.label}</span>
                          {opt.description && (
                            <p className="text-zinc-500 text-xs mt-0.5">{opt.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {!sent && (
                  <div>
                    {!showCustom ? (
                      <button
                        onClick={() => setShowCustom(true)}
                        className="w-full text-left px-3 py-2 rounded-md border border-dashed border-zinc-600 text-sm text-zinc-500 hover:border-violet-400 hover:text-zinc-400 transition-colors"
                      >
                        직접 입력...
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={customText}
                          onChange={(e) => setCustomText(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSubmitCustom()}
                          placeholder="직접 입력하세요..."
                          className="flex-1 px-3 py-2 rounded-md border border-zinc-600 bg-zinc-800 text-sm text-zinc-200 focus:outline-none focus:border-violet-500"
                          autoFocus
                        />
                        <button
                          onClick={handleSubmitCustom}
                          disabled={!customText.trim()}
                          className="px-3 py-2 rounded-md bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm transition-colors shrink-0"
                        >
                          전송
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {needsSubmitButton && !sent && Object.keys(selections).length > 0 && (
          <button
            onClick={handleSubmitAll}
            className="w-full py-2 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
          >
            응답 전송
          </button>
        )}
      </div>
    </div>
  );
}

// --- EnterPlanMode ---

function EnterPlanModePanel({ result, onSendMessage }: Omit<Props, "tool">) {
  const [sent, setSent] = useState(false);

  const handleApprove = () => {
    if (sent) return;
    onSendMessage?.("네, 계획 모드로 진입해주세요.");
    setSent(true);
  };

  const handleReject = () => {
    if (sent) return;
    onSendMessage?.("아니요, 계획 모드 없이 바로 구현해주세요.");
    setSent(true);
  };

  return (
    <div className="my-2 border border-amber-500/40 rounded-lg overflow-hidden">
      <div className="bg-amber-900/20 px-3 py-2 flex items-center gap-2 border-b border-amber-500/20">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <path d="M10 12h4" />
          <path d="M10 16h4" />
        </svg>
        <span className="text-amber-300 font-medium text-sm">계획 모드 진입 요청</span>
        {(!!result || sent) && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-800/60 text-amber-300 ml-auto">
            {sent ? "응답 전송됨" : "자동 승인됨"}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-zinc-300 text-sm mb-3">
          Claude가 계획 모드로 진입하려고 합니다. 코드를 직접 변경하지 않고 구현 계획을 먼저 수립합니다.
        </p>
        {!sent && (
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium transition-colors"
            >
              승인
            </button>
            <button
              onClick={handleReject}
              className="px-4 py-2 rounded-md bg-zinc-600 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors"
            >
              거부
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- ExitPlanMode ---

function ExitPlanModePanel({ result, onSendMessage }: Omit<Props, "tool">) {
  const [sent, setSent] = useState(false);

  const handleApprove = () => {
    if (sent) return;
    onSendMessage?.("계획을 승인합니다. 구현을 시작해주세요.");
    setSent(true);
  };

  const handleReject = () => {
    if (sent) return;
    onSendMessage?.("계획을 수정해주세요.");
    setSent(true);
  };

  return (
    <div className="my-2 border border-emerald-500/40 rounded-lg overflow-hidden">
      <div className="bg-emerald-900/20 px-3 py-2 flex items-center gap-2 border-b border-emerald-500/20">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <span className="text-emerald-300 font-medium text-sm">계획 수립 완료</span>
        {(!!result || sent) && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-800/60 text-emerald-300 ml-auto">
            {sent ? "응답 전송됨" : "자동 승인됨"}
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-zinc-300 text-sm mb-3">
          Claude가 구현 계획 수립을 완료했습니다. 승인하면 구현을 시작합니다.
        </p>
        {!sent && (
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
            >
              승인
            </button>
            <button
              onClick={handleReject}
              className="px-4 py-2 rounded-md bg-zinc-600 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors"
            >
              수정 요청
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
