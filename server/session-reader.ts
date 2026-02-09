import fs from "fs";
import path from "path";
import { getSessionDir } from "./path-encoder";

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ParsedMessage {
  type: "user" | "assistant";
  content: unknown;
  timestamp: string;
  uuid: string;
  toolUseResult?: unknown;
}

/**
 * 주어진 프로젝트 디렉토리의 세션 목록을 반환한다.
 */
export async function listSessions(projectDir: string): Promise<SessionSummary[]> {
  const sessionDir = getSessionDir(projectDir);

  if (!fs.existsSync(sessionDir)) {
    return [];
  }

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  const sessions: SessionSummary[] = [];

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const id = path.basename(file, ".jsonl");

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      let title = "새 대화";
      let createdAt = "";
      let updatedAt = "";

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "user" && parsed.message?.content && !createdAt) {
            const rawContent = parsed.message.content;
            if (typeof rawContent === "string") {
              title = rawContent.substring(0, 80);
            } else if (Array.isArray(rawContent)) {
              const textBlock = rawContent.find(
                (b: { type: string }) => b.type !== "tool_result"
              );
              if (textBlock) {
                title = String(textBlock.text || textBlock.content || "").substring(0, 80);
              }
            }
            createdAt = parsed.timestamp || "";
          }
          if (parsed.timestamp) {
            updatedAt = parsed.timestamp;
          }
        } catch {
          // 개별 라인 파싱 실패는 무시
        }
      }

      if (createdAt) {
        sessions.push({ id, title, createdAt, updatedAt });
      }
    } catch {
      // 파일 읽기 실패는 무시
    }
  }

  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

/**
 * 특정 세션의 대화 히스토리를 반환한다.
 */
export async function getSessionMessages(
  projectDir: string,
  sessionId: string
): Promise<ParsedMessage[]> {
  const sessionDir = getSessionDir(projectDir);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const messages: ParsedMessage[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "user" || parsed.type === "assistant") {
        const msg: ParsedMessage = {
          type: parsed.type,
          content: parsed.message?.content,
          timestamp: parsed.timestamp || "",
          uuid: parsed.uuid || "",
        };
        if (parsed.toolUseResult) {
          msg.toolUseResult = parsed.toolUseResult;
        }
        messages.push(msg);
      }
    } catch {
      // 파싱 실패 라인 무시
    }
  }

  return messages;
}

/**
 * JSONL의 user 라인이 사용자가 직접 입력한 메시지인지 판별한다.
 * (tool_result가 아닌 텍스트 콘텐츠를 포함하는 user 메시지)
 */
function isUserInputMessage(parsed: Record<string, unknown>): boolean {
  if (parsed.type !== "user") return false;
  const msg = parsed.message as { content?: unknown[] } | undefined;
  if (!msg?.content || !Array.isArray(msg.content)) return false;
  return msg.content.some((b) => {
    const block = b as Record<string, unknown>;
    return block.type === "text";
  });
}

/**
 * 세션을 특정 유저 턴 시점으로 되감는다.
 * userTurnIndex번째 사용자 입력 메시지(0-based) 이전까지만 유지하고 나머지를 잘라낸다.
 * 안전을 위해 .bak 백업 파일을 생성한다.
 */
export async function rewindSession(
  projectDir: string,
  sessionId: string,
  userTurnIndex: number
): Promise<{ ok: boolean; messagesRemoved: number }> {
  const sessionDir = getSessionDir(projectDir);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return { ok: false, messagesRemoved: 0 };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // userTurnIndex번째 사용자 입력 메시지의 라인 인덱스 찾기
  let cutIndex = -1;
  let turnCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (isUserInputMessage(parsed)) {
        if (turnCount === userTurnIndex) {
          cutIndex = i;
          break;
        }
        turnCount++;
      }
    } catch {
      // 파싱 실패 무시
    }
  }

  if (cutIndex < 0) {
    return { ok: false, messagesRemoved: 0 };
  }

  // 잘라낼 메시지 수 계산 (user/assistant만 카운트)
  let messagesRemoved = 0;
  for (let i = cutIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "user" || parsed.type === "assistant") {
        messagesRemoved++;
      }
    } catch {
      // 무시
    }
  }

  // 백업 생성
  const backupPath = filePath + ".bak";
  fs.writeFileSync(backupPath, content, "utf-8");

  // cutIndex 이전까지만 유지
  const remaining = lines.slice(0, cutIndex).join("\n");
  fs.writeFileSync(filePath, remaining.endsWith("\n") ? remaining : remaining + "\n", "utf-8");

  return { ok: true, messagesRemoved };
}

/**
 * 세션 JSONL 파일을 삭제한다.
 */
export async function deleteSession(projectDir: string, sessionId: string): Promise<boolean> {
  const sessionDir = getSessionDir(projectDir);
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return false;
  }

  fs.unlinkSync(filePath);
  return true;
}
