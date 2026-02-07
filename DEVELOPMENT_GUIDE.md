# Claude Code Web UI - 개발 가이드

이 문서를 순서대로 따라하면 Claude Code CLI를 웹 UI로 사용할 수 있는 애플리케이션이 완성된다.

## 환경 정보

- Node.js: v23.11.0
- pnpm: 10.28.2
- Claude Code CLI: 2.1.34
- OS: Windows
- claude 경로: `C:\Users\kim\AppData\Roaming\npm\claude.cmd`

---

## Phase 1: 프로젝트 초기화 및 기본 채팅

### Step 1-1: Next.js 프로젝트 생성

```bash
cd C:\Users\kim\Desktop\projects\claude-web-ui
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --turbopack
```

선택지가 나오면:
- TypeScript: Yes
- ESLint: Yes
- Tailwind CSS: Yes
- src/ directory: Yes
- App Router: Yes
- Turbopack: Yes
- import alias: No (기본값 @/* 사용)

### Step 1-2: 의존성 설치

```bash
cd C:\Users\kim\Desktop\projects\claude-web-ui

# 백엔드 서버
pnpm add express socket.io cors

# 프론트엔드 socket.io 클라이언트
pnpm add socket.io-client

# 상태 관리
pnpm add zustand

# 마크다운 렌더링
pnpm add react-markdown remark-gfm rehype-highlight

# UI 관련
pnpm add lucide-react

# 개발 의존성 (서버 TS 빌드 + 실행)
pnpm add -D tsx @types/express @types/cors concurrently
```

> shadcn/ui와 코드 하이라이팅(shiki), diff 뷰어는 Phase 2에서 추가한다.

### Step 1-3: 서버 디렉토리 생성

```bash
mkdir server
```

### Step 1-4: `server/path-encoder.ts` 작성

프로젝트 디렉토리 경로를 Claude CLI의 세션 저장 디렉토리명으로 인코딩/디코딩하는 유틸.

```typescript
// server/path-encoder.ts
import path from "path";

/**
 * 프로젝트 디렉토리 경로를 Claude CLI 세션 디렉토리명으로 인코딩
 * 예: "C:\Users\kim\Desktop" → "C--Users-kim-Desktop"
 * 규칙: 경로 구분자(\, /, :)를 "-"로 치환
 */
export function encodePath(dirPath: string): string {
  const normalized = path.resolve(dirPath);
  return normalized.replace(/[\\/: ]/g, "-");
}

/**
 * Claude CLI 세션 저장 디렉토리의 전체 경로를 반환
 */
export function getSessionDir(projectDir: string): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const encoded = encodePath(projectDir);
  return path.join(homeDir, ".claude", "projects", encoded);
}
```

### Step 1-5: `server/stream-parser.ts` 작성

CLI stdout에서 나오는 NDJSON을 줄 단위로 버퍼링하여 파싱하는 모듈.

```typescript
// server/stream-parser.ts
import { EventEmitter } from "events";

/**
 * NDJSON (Newline-Delimited JSON) 스트림 파서.
 * stdout 데이터를 줄바꿈 기준으로 버퍼링한 뒤 JSON.parse한다.
 *
 * 이벤트:
 *   "data"  — 파싱된 JSON 객체
 *   "error" — 파싱 실패한 라인 (스킵하고 계속 진행)
 */
export class StreamParser extends EventEmitter {
  private buffer = "";

  /**
   * stdout의 data 청크를 받아서 처리한다.
   * 줄바꿈(\n)을 기준으로 분리하고, 완성된 라인만 파싱한다.
   * 마지막 줄이 불완전하면 다음 청크에서 이어서 처리된다.
   */
  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // 마지막 요소는 아직 불완전할 수 있으므로 버퍼에 보관
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        this.emit("data", parsed);
      } catch {
        this.emit("error", trimmed);
      }
    }
  }

  /**
   * 스트림 종료 시 버퍼에 남은 데이터를 처리한다.
   */
  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        this.emit("data", parsed);
      } catch {
        this.emit("error", trimmed);
      }
    }
    this.buffer = "";
  }
}
```

### Step 1-6: `server/claude-cli.ts` 작성

Claude CLI 프로세스를 spawn/kill하는 매니저.

```typescript
// server/claude-cli.ts
import { spawn, ChildProcess, execSync } from "child_process";
import { StreamParser } from "./stream-parser";
import { EventEmitter } from "events";

interface RunOptions {
  message: string;
  sessionId?: string | null; // null이면 새 세션
  model?: string;
  cwd: string;
}

/**
 * Claude CLI 프로세스 매니저.
 *
 * 이벤트:
 *   "data"  — 파싱된 stream-json 이벤트 객체
 *   "error" — 에러 메시지 (string)
 *   "exit"  — 프로세스 종료 (code: number | null)
 */
export class ClaudeCliManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private parser: StreamParser | null = null;
  private _busy = false;

  get busy(): boolean {
    return this._busy;
  }

  /**
   * Claude CLI를 실행한다.
   * 이미 실행 중이면 false를 반환한다.
   */
  run(options: RunOptions): boolean {
    if (this._busy) return false;

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
    ];

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    args.push(options.message);

    this._busy = true;
    this.parser = new StreamParser();

    // Windows에서는 claude.cmd를 사용하므로 shell: true 필요
    this.process = spawn("claude", args, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.parser.on("data", (data: unknown) => {
      this.emit("data", data);
    });

    this.parser.on("error", (line: string) => {
      console.error("[StreamParser] 파싱 실패:", line.substring(0, 200));
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser?.feed(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString("utf-8");
      console.error("[claude stderr]", msg);
      // stderr 내용 중 사용자에게 의미 있는 에러만 전달
      if (msg.includes("Error") || msg.includes("error")) {
        this.emit("error", msg);
      }
    });

    this.process.on("close", (code) => {
      this.parser?.flush();
      this._busy = false;
      this.process = null;
      this.parser = null;
      this.emit("exit", code);
    });

    this.process.on("error", (err) => {
      this._busy = false;
      this.process = null;
      this.parser = null;
      this.emit("error", `CLI 실행 실패: ${err.message}`);
      this.emit("exit", 1);
    });

    return true;
  }

  /**
   * 실행 중인 프로세스를 중단한다.
   * Windows에서는 taskkill로 프로세스 트리 전체를 종료한다.
   */
  abort(): void {
    if (!this.process || !this._busy) return;

    const pid = this.process.pid;
    if (!pid) return;

    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } else {
        this.process.kill("SIGTERM");
      }
    } catch {
      // 이미 종료된 프로세스일 수 있음
    }
  }
}
```

### Step 1-7: `server/session-reader.ts` 작성

`~/.claude/projects/` 하위의 JSONL 세션 파일을 읽어서 세션 목록과 대화 히스토리를 제공하는 모듈.

```typescript
// server/session-reader.ts
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
 * ~/.claude/projects/<encoded-dir>/ 하위의 .jsonl 파일을 읽는다.
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
          // 첫 번째 user 메시지를 제목으로 사용
          if (parsed.type === "user" && parsed.message?.content && !createdAt) {
            const rawContent = parsed.message.content;
            if (typeof rawContent === "string") {
              title = rawContent.substring(0, 80);
            } else if (Array.isArray(rawContent)) {
              // tool_result 형태의 content는 건너뜀
              const textBlock = rawContent.find(
                (b: { type: string }) => b.type !== "tool_result"
              );
              if (textBlock) {
                title = String(textBlock.text || textBlock.content || "").substring(0, 80);
              }
            }
            createdAt = parsed.timestamp || "";
          }
          // 마지막 메시지의 timestamp를 업데이트 시간으로 사용
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

  // 최신 순으로 정렬
  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

/**
 * 특정 세션의 대화 히스토리를 반환한다.
 * JSONL 파일에서 user/assistant 타입 메시지만 추출한다.
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
```

### Step 1-8: `server/index.ts` 작성

Express + socket.io 커스텀 서버.

```typescript
// server/index.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { ClaudeCliManager } from "./claude-cli";
import { listSessions, getSessionMessages, deleteSession } from "./session-reader";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB
});

// --- 설정 파일 경로 ---
const configDir = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".claude-web-ui"
);
const settingsPath = path.join(configDir, "settings.json");
const recentDirsPath = path.join(configDir, "recent-dirs.json");

function ensureConfigDir(): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

// --- REST API ---

// 세션 목록
app.get("/api/sessions", async (req, res) => {
  const cwd = req.query.cwd as string;
  if (!cwd) return res.status(400).json({ error: "cwd 파라미터 필요" });
  const sessions = await listSessions(cwd);
  res.json({ sessions });
});

// 세션 메시지 히스토리
app.get("/api/sessions/:id/messages", async (req, res) => {
  const cwd = req.query.cwd as string;
  if (!cwd) return res.status(400).json({ error: "cwd 파라미터 필요" });
  const messages = await getSessionMessages(cwd, req.params.id);
  res.json({ messages });
});

// 세션 삭제
app.delete("/api/sessions/:id", async (req, res) => {
  const cwd = req.query.cwd as string;
  if (!cwd) return res.status(400).json({ error: "cwd 파라미터 필요" });
  const deleted = await deleteSession(cwd, req.params.id);
  res.json({ deleted });
});

// 설정 조회
app.get("/api/settings", (_req, res) => {
  ensureConfigDir();
  if (fs.existsSync(settingsPath)) {
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    res.json(data);
  } else {
    res.json({ model: "sonnet", cwd: process.cwd() });
  }
});

// 설정 저장
app.post("/api/settings", (req, res) => {
  ensureConfigDir();
  fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// 최근 디렉토리 목록
app.get("/api/directories/recent", (_req, res) => {
  ensureConfigDir();
  if (fs.existsSync(recentDirsPath)) {
    const data = JSON.parse(fs.readFileSync(recentDirsPath, "utf-8"));
    res.json(data);
  } else {
    res.json({ directories: [] });
  }
});

// 디렉토리 경로 검증
app.post("/api/directories/validate", (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ valid: false, error: "경로 필요" });
  const valid = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  res.json({ valid });
});

// 최근 디렉토리에 추가하는 헬퍼
function addRecentDir(dirPath: string): void {
  ensureConfigDir();
  let dirs: string[] = [];
  if (fs.existsSync(recentDirsPath)) {
    const data = JSON.parse(fs.readFileSync(recentDirsPath, "utf-8"));
    dirs = data.directories || [];
  }
  // 중복 제거 후 맨 앞에 추가, 최대 20개
  dirs = [dirPath, ...dirs.filter((d: string) => d !== dirPath)].slice(0, 20);
  fs.writeFileSync(recentDirsPath, JSON.stringify({ directories: dirs }, null, 2));
}

// --- WebSocket ---

// 소켓별 CLI 매니저 관리
const managers = new Map<string, ClaudeCliManager>();

io.on("connection", (socket) => {
  console.log(`[socket.io] 클라이언트 연결: ${socket.id}`);

  const manager = new ClaudeCliManager();
  managers.set(socket.id, manager);

  // CLI 이벤트를 소켓으로 중계
  manager.on("data", (event: unknown) => {
    socket.emit("stream", event);
  });

  manager.on("error", (msg: string) => {
    socket.emit("error", { message: msg, code: "PROCESS_ERROR" });
  });

  manager.on("exit", (code: number | null) => {
    socket.emit("exit", { code });
  });

  // 메시지 전송
  socket.on("send_message", (data: {
    message: string;
    session_id?: string | null;
    model?: string;
    cwd: string;
  }) => {
    if (manager.busy) {
      socket.emit("busy", { message: "이미 실행 중인 요청이 있습니다." });
      return;
    }

    if (!data.message?.trim()) {
      socket.emit("error", { message: "빈 메시지", code: "INVALID_INPUT" });
      return;
    }

    // 최근 디렉토리에 추가
    addRecentDir(data.cwd);

    const started = manager.run({
      message: data.message,
      sessionId: data.session_id,
      model: data.model,
      cwd: data.cwd,
    });

    if (!started) {
      socket.emit("busy", { message: "이미 실행 중인 요청이 있습니다." });
    }
  });

  // 중단
  socket.on("abort", () => {
    manager.abort();
  });

  // 연결 해제
  socket.on("disconnect", () => {
    console.log(`[socket.io] 클라이언트 연결 해제: ${socket.id}`);
    manager.abort(); // 실행 중인 프로세스가 있으면 종료
    managers.delete(socket.id);
  });
});

// --- 서버 시작 ---
const PORT = 3001;
httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[서버] WebSocket + REST 서버 시작: http://127.0.0.1:${PORT}`);
});
```

### Step 1-9: `tsconfig.server.json` 작성

서버용 TypeScript 설정.

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist/server",
    "rootDir": "./server",
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["server/**/*.ts"]
}
```

### Step 1-10: `package.json` scripts 수정

`package.json`의 `scripts` 섹션을 다음으로 교체한다:

```json
{
  "scripts": {
    "dev": "concurrently \"pnpm dev:next\" \"pnpm dev:server\"",
    "dev:next": "next dev --turbopack",
    "dev:server": "tsx watch server/index.ts",
    "build": "next build",
    "start": "next start"
  }
}
```

### Step 1-11: `src/lib/socket-client.ts` 작성

프론트엔드에서 socket.io 클라이언트를 싱글턴으로 관리.

```typescript
// src/lib/socket-client.ts
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io("http://localhost:3001", {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}
```

### Step 1-12: `src/stores/chatStore.ts` 작성

채팅 상태를 관리하는 zustand 스토어.

```typescript
// src/stores/chatStore.ts
import { create } from "zustand";

// 메시지 content 블록 타입
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: ContentBlock[];
  timestamp: string;
  // 도구 실행 결과 (user 타입의 tool_result에 대한 상세 정보)
  toolUseResult?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
  };
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string; // 현재 스트리밍 중인 텍스트
  sessionId: string | null;
  usage: UsageInfo;

  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  appendStreamingText: (text: string) => void;
  clearStreamingText: () => void;
  setIsStreaming: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setUsage: (u: Partial<UsageInfo>) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  streamingText: "",
  sessionId: null,
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCostUsd: 0,
  },

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  appendStreamingText: (text) =>
    set((s) => ({ streamingText: s.streamingText + text })),
  clearStreamingText: () => set({ streamingText: "" }),
  setIsStreaming: (v) => set({ isStreaming: v }),
  setSessionId: (id) => set({ sessionId: id }),
  setUsage: (u) => set((s) => ({ usage: { ...s.usage, ...u } })),
  clearChat: () =>
    set({
      messages: [],
      streamingText: "",
      isStreaming: false,
      sessionId: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
      },
    }),
}));
```

### Step 1-13: `src/stores/settingsStore.ts` 작성

설정 상태 스토어.

```typescript
// src/stores/settingsStore.ts
import { create } from "zustand";

interface SettingsState {
  model: string;
  cwd: string;
  connected: boolean;

  setModel: (m: string) => void;
  setCwd: (c: string) => void;
  setConnected: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  model: "sonnet",
  cwd: "C:\\Users\\kim\\Desktop\\projects",
  connected: false,

  setModel: (m) => set({ model: m }),
  setCwd: (c) => set({ cwd: c }),
  setConnected: (v) => set({ connected: v }),
}));
```

### Step 1-14: `src/hooks/useSocket.ts` 작성

socket.io 연결을 관리하고 CLI 이벤트를 chatStore에 반영하는 훅.

```typescript
// src/hooks/useSocket.ts
"use client";

import { useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket-client";
import { useChatStore, ChatMessage, ContentBlock } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";

// stream-json 이벤트 타입
interface SystemEvent {
  type: "system";
  session_id: string;
}

interface StreamEvent {
  type: "stream_event";
  event: {
    type: string;
    delta?: { type: string; text?: string };
    index?: number;
    content_block?: { type: string };
  };
}

interface AssistantEvent {
  type: "assistant";
  message: {
    content: ContentBlock[];
  };
  session_id: string;
}

interface UserEvent {
  type: "user";
  message: {
    content: ContentBlock[];
  };
  tool_use_result?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
  };
}

interface ResultEvent {
  type: "result";
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

type CLIEvent = SystemEvent | StreamEvent | AssistantEvent | UserEvent | ResultEvent;

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const store = useChatStore();
  const settings = useSettingsStore();

  // refs로 최신 상태를 추적하여 useEffect 내 콜백에서 사용
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[socket.io] 연결됨");
      useSettingsStore.getState().setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("[socket.io] 연결 해제");
      useSettingsStore.getState().setConnected(false);
    });

    socket.on("stream", (event: CLIEvent) => {
      const s = storeRef.current;

      switch (event.type) {
        case "system":
          // 세션 ID 저장
          if (!useChatStore.getState().sessionId) {
            useChatStore.getState().setSessionId(event.session_id);
          }
          break;

        case "stream_event": {
          const evt = (event as StreamEvent).event;
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
            useChatStore.getState().appendStreamingText(evt.delta.text);
          }
          break;
        }

        case "assistant": {
          const assistantEvt = event as AssistantEvent;
          // 스트리밍 텍스트를 초기화하고 완성된 메시지를 추가
          useChatStore.getState().clearStreamingText();

          const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantEvt.message.content,
            timestamp: new Date().toISOString(),
          };
          useChatStore.getState().addMessage(msg);

          // 세션 ID 갱신
          if (assistantEvt.session_id) {
            useChatStore.getState().setSessionId(assistantEvt.session_id);
          }
          break;
        }

        case "user": {
          const userEvt = event as UserEvent;
          // 도구 실행 결과 메시지 추가
          const toolMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: userEvt.message.content as ContentBlock[],
            timestamp: new Date().toISOString(),
            toolUseResult: userEvt.tool_use_result,
          };
          useChatStore.getState().addMessage(toolMsg);
          break;
        }

        case "result": {
          const resultEvt = event as ResultEvent;
          useChatStore.getState().setIsStreaming(false);
          useChatStore.getState().clearStreamingText();
          useChatStore.getState().setSessionId(resultEvt.session_id);
          useChatStore.getState().setUsage({
            inputTokens: resultEvt.usage.input_tokens,
            outputTokens: resultEvt.usage.output_tokens,
            cacheReadTokens: resultEvt.usage.cache_read_input_tokens || 0,
            cacheCreationTokens: resultEvt.usage.cache_creation_input_tokens || 0,
            totalCostUsd: resultEvt.total_cost_usd,
          });
          break;
        }
      }
    });

    socket.on("error", (data: { message: string; code: string }) => {
      console.error("[socket.io] 에러:", data);
      useChatStore.getState().setIsStreaming(false);
    });

    socket.on("busy", (data: { message: string }) => {
      console.warn("[socket.io] busy:", data.message);
    });

    socket.on("exit", (data: { code: number | null }) => {
      useChatStore.getState().setIsStreaming(false);
      useChatStore.getState().clearStreamingText();
      if (data.code !== 0 && data.code !== null) {
        console.error("[socket.io] CLI 비정상 종료, code:", data.code);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("stream");
      socket.off("error");
      socket.off("busy");
      socket.off("exit");
    };
  }, []);

  const sendMessage = useCallback((message: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    const chatState = useChatStore.getState();
    const settingsState = useSettingsStore.getState();

    // 사용자 메시지를 UI에 즉시 추가
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: [{ type: "text", text: message }],
      timestamp: new Date().toISOString(),
    };
    chatState.addMessage(userMsg);
    chatState.setIsStreaming(true);

    socket.emit("send_message", {
      message,
      session_id: chatState.sessionId,
      model: settingsState.model,
      cwd: settingsState.cwd,
    });
  }, []);

  const abort = useCallback(() => {
    socketRef.current?.emit("abort");
  }, []);

  return { sendMessage, abort };
}
```

### Step 1-15: `src/components/chat/MessageInput.tsx` 작성

메시지 입력 컴포넌트.

```tsx
// src/components/chat/MessageInput.tsx
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
    // 텍스트에어리어 높이 리셋
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
```

### Step 1-16: `src/components/chat/ChatArea.tsx` 작성

채팅 영역 컴포넌트. Phase 1에서는 단순 텍스트 렌더링만 한다 (마크다운은 Phase 2).

```tsx
// src/components/chat/ChatArea.tsx
"use client";

import { useEffect, useRef } from "react";
import { useChatStore, ChatMessage, ContentBlock, ToolUseBlock } from "@/stores/chatStore";

function renderContent(content: ContentBlock[]): React.ReactNode {
  return content.map((block, i) => {
    if (block.type === "text") {
      return (
        <div key={i} className="whitespace-pre-wrap break-words">
          {block.text}
        </div>
      );
    }
    if (block.type === "tool_use") {
      const tool = block as ToolUseBlock;
      return (
        <div key={i} className="my-2 border border-zinc-600 rounded-lg overflow-hidden">
          <div className="bg-zinc-700 px-3 py-1.5 text-sm font-mono text-zinc-300">
            {tool.name}: {tool.input.command || tool.input.file_path || tool.input.pattern || JSON.stringify(tool.input).substring(0, 100)}
          </div>
        </div>
      );
    }
    if (block.type === "tool_result") {
      const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      return (
        <div key={i} className="my-2 border border-zinc-600 rounded-lg overflow-hidden">
          <pre className="bg-zinc-800 px-3 py-2 text-sm font-mono text-zinc-400 overflow-x-auto max-h-[300px] overflow-y-auto">
            {content.substring(0, 3000)}
            {content.length > 3000 && "\n... (출력 생략)"}
          </pre>
        </div>
      );
    }
    return null;
  });
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  // tool_result를 가진 user 메시지는 별도 표시
  if (msg.role === "user" && msg.content.some((b) => b.type === "tool_result")) {
    return <div className="max-w-4xl mx-auto">{renderContent(msg.content)}</div>;
  }

  const isUser = msg.role === "user";

  return (
    <div className={`max-w-4xl mx-auto ${isUser ? "flex justify-end" : ""}`}>
      <div
        className={`rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white max-w-[80%]"
            : "bg-zinc-800 text-zinc-100 w-full"
        }`}
      >
        {renderContent(msg.content)}
      </div>
    </div>
  );
}

export default function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const usage = useChatStore((s) => s.usage);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-zinc-500">
            메시지를 입력하여 대화를 시작하세요.
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {/* 스트리밍 중인 텍스트 */}
        {streamingText && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-zinc-800 text-zinc-100 rounded-lg px-4 py-3 w-full">
              <div className="whitespace-pre-wrap break-words">
                {streamingText}
                <span className="inline-block w-2 h-4 bg-blue-400 ml-0.5 animate-pulse" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* 토큰/비용 표시 */}
      {usage.totalCostUsd > 0 && (
        <div className="border-t border-zinc-700 px-4 py-1.5 text-xs text-zinc-500 flex gap-4 justify-center">
          <span>입력: {usage.inputTokens.toLocaleString()}</span>
          <span>출력: {usage.outputTokens.toLocaleString()}</span>
          <span>캐시: {usage.cacheReadTokens.toLocaleString()}</span>
          <span>비용: ${usage.totalCostUsd.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}
```

### Step 1-17: `src/components/header/Header.tsx` 작성

Phase 1에서는 모델 선택과 디렉토리 입력만 넣는다.

```tsx
// src/components/header/Header.tsx
"use client";

import { useSettingsStore } from "@/stores/settingsStore";
import { useState } from "react";

export default function Header() {
  const { model, setModel, cwd, setCwd, connected } = useSettingsStore();
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
      {/* 연결 상태 */}
      <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />

      {/* 모델 선택 */}
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="bg-zinc-800 text-zinc-200 text-sm border border-zinc-600 rounded px-2 py-1"
      >
        <option value="opus">Opus</option>
        <option value="sonnet">Sonnet</option>
        <option value="haiku">Haiku</option>
      </select>

      {/* 디렉토리 */}
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
    </header>
  );
}
```

### Step 1-18: `src/components/sidebar/SessionList.tsx` 작성

Phase 1에서는 간단한 세션 목록만 표시.

```tsx
// src/components/sidebar/SessionList.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const cwd = useSettingsStore((s) => s.cwd);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `http://localhost:3001/api/sessions?cwd=${encodeURIComponent(cwd)}`
      );
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      console.error("세션 목록 로드 실패");
    }
  }, [cwd]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // 스트리밍 완료 후 세션 목록 갱신
  useEffect(() => {
    if (!isStreaming) {
      fetchSessions();
    }
  }, [isStreaming, fetchSessions]);

  const handleNewChat = () => {
    useChatStore.getState().clearChat();
  };

  const handleSelectSession = async (sessionId: string) => {
    if (isStreaming) return;

    try {
      const res = await fetch(
        `http://localhost:3001/api/sessions/${sessionId}/messages?cwd=${encodeURIComponent(cwd)}`
      );
      const data = await res.json();

      const messages = (data.messages || []).map((m: {
        type: string;
        content: unknown;
        timestamp: string;
        uuid: string;
        toolUseResult?: unknown;
      }) => ({
        id: m.uuid || crypto.randomUUID(),
        role: m.type as "user" | "assistant",
        content: typeof m.content === "string"
          ? [{ type: "text" as const, text: m.content }]
          : Array.isArray(m.content)
            ? m.content
            : [{ type: "text" as const, text: String(m.content) }],
        timestamp: m.timestamp,
        toolUseResult: m.toolUseResult,
      }));

      useChatStore.getState().setMessages(messages);
      useChatStore.getState().setSessionId(sessionId);
    } catch {
      console.error("세션 메시지 로드 실패");
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm("이 세션을 삭제할까요?")) return;

    try {
      await fetch(
        `http://localhost:3001/api/sessions/${sessionId}?cwd=${encodeURIComponent(cwd)}`,
        { method: "DELETE" }
      );
      fetchSessions();
      if (currentSessionId === sessionId) {
        useChatStore.getState().clearChat();
      }
    } catch {
      console.error("세션 삭제 실패");
    }
  };

  return (
    <aside className="w-64 border-r border-zinc-700 bg-zinc-900 flex flex-col shrink-0">
      <div className="p-3 border-b border-zinc-700">
        <button
          onClick={handleNewChat}
          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors"
        >
          + 새 대화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => handleSelectSession(s.id)}
            className={`group px-3 py-2.5 cursor-pointer border-b border-zinc-800 hover:bg-zinc-800 transition-colors ${
              currentSessionId === s.id ? "bg-zinc-800" : ""
            }`}
          >
            <div className="text-sm text-zinc-300 truncate">{s.title}</div>
            <div className="flex justify-between items-center mt-1">
              <div className="text-xs text-zinc-500">
                {new Date(s.updatedAt).toLocaleDateString("ko-KR")}
              </div>
              <button
                onClick={(e) => handleDeleteSession(e, s.id)}
                className="text-xs text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
```

### Step 1-19: `src/app/layout.tsx` 수정

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Code Web UI",
  description: "Claude Code CLI Web Interface",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
```

### Step 1-20: `src/app/page.tsx` 수정

메인 페이지. 사이드바 + 채팅 영역 + 입력을 조합한다.

```tsx
// src/app/page.tsx
"use client";

import { useSocket } from "@/hooks/useSocket";
import Header from "@/components/header/Header";
import SessionList from "@/components/sidebar/SessionList";
import ChatArea from "@/components/chat/ChatArea";
import MessageInput from "@/components/chat/MessageInput";

export default function Home() {
  const { sendMessage, abort } = useSocket();

  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <SessionList />
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatArea />
          <MessageInput onSend={sendMessage} onAbort={abort} />
        </main>
      </div>
    </div>
  );
}
```

### Step 1-21: `src/app/globals.css` 수정

```css
/* src/app/globals.css */
@import "tailwindcss";

/* 스크롤바 스타일링 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #3f3f46;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #52525b;
}
```

### Step 1-22: Phase 1 실행 및 확인

```bash
cd C:\Users\kim\Desktop\projects\claude-web-ui
pnpm dev
```

브라우저에서 `http://localhost:3000` 접속.

**확인 사항:**
1. 서버 로그에 `[서버] WebSocket + REST 서버 시작: http://127.0.0.1:3001` 출력되는지
2. 브라우저에서 헤더 왼쪽에 녹색 점 (WebSocket 연결 표시)이 보이는지
3. 메시지 입력 후 전송 시 스트리밍 응답이 오는지
4. 중단 버튼이 동작하는지
5. 새 대화 버튼으로 초기화되는지
6. 사이드바에 세션 목록이 나타나는지

---

## Phase 2: 마크다운 렌더링 + 도구 사용 표시

### Step 2-1: highlight.js CSS 추가

`src/app/globals.css`에 highlight.js 테마를 추가한다:

```css
/* src/app/globals.css — 기존 내용 하단에 추가 */
@import "highlight.js/styles/github-dark.min.css";
```

> `rehype-highlight`가 highlight.js를 사용하므로 CSS만 추가하면 된다.

### Step 2-2: `src/components/chat/MarkdownRenderer.tsx` 작성

마크다운 렌더링 전용 컴포넌트.

```tsx
// src/components/chat/MarkdownRenderer.tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Props {
  content: string;
}

export default function MarkdownRenderer({ content }: Props) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
      prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700
      prose-code:text-blue-300 prose-code:before:content-none prose-code:after:content-none
      prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
      prose-table:border-collapse prose-th:border prose-th:border-zinc-600 prose-th:px-3 prose-th:py-1
      prose-td:border prose-td:border-zinc-700 prose-td:px-3 prose-td:py-1
      break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

### Step 2-3: tailwind에 typography 플러그인 추가

```bash
pnpm add @tailwindcss/typography
```

`tailwind.config.ts`에 plugins 추가:

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [typography],
};
export default config;
```

### Step 2-4: `src/components/chat/ToolUsePanel.tsx` 작성

도구 사용을 접을 수 있는 패널로 표시하는 컴포넌트.

```tsx
// src/components/chat/ToolUsePanel.tsx
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

  // 도구 입력값에서 표시할 요약 텍스트
  const summary = tool.input.command
    || tool.input.file_path
    || tool.input.pattern
    || tool.input.query
    || JSON.stringify(tool.input).substring(0, 80);

  return (
    <div className="my-2 border border-zinc-600 rounded-lg overflow-hidden text-sm">
      {/* 헤더 - 항상 표시 */}
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

      {/* 상세 내용 - 접기/펼치기 */}
      {expanded && (
        <div className="border-t border-zinc-600">
          {/* 입력 */}
          <div className="px-3 py-2 bg-zinc-800">
            <div className="text-xs text-zinc-500 mb-1">입력</div>
            <pre className="text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {/* 결과 */}
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
```

### Step 2-5: `src/components/chat/ChatArea.tsx` 업데이트

마크다운 렌더러와 도구 사용 패널을 적용하도록 ChatArea를 수정한다.
기존 `ChatArea.tsx`를 다음 내용으로 **전체 교체**한다:

```tsx
// src/components/chat/ChatArea.tsx
"use client";

import { useEffect, useRef } from "react";
import { useChatStore, ChatMessage, ContentBlock, ToolUseBlock } from "@/stores/chatStore";
import MarkdownRenderer from "./MarkdownRenderer";
import ToolUsePanel from "./ToolUsePanel";

/**
 * 도구 사용과 그에 대응하는 결과를 매칭하여 표시한다.
 * assistant의 tool_use → 바로 다음 user의 tool_result를 찾아서 연결.
 */
function findToolResult(
  toolUseId: string,
  messages: ChatMessage[],
  currentIndex: number
): { content: string; is_error: boolean; stdout?: string; stderr?: string } | undefined {
  // 현재 메시지 다음에 오는 user 메시지(tool_result)를 찾는다
  for (let i = currentIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user" && msg.content) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
          return {
            content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
            is_error: block.is_error,
            stdout: msg.toolUseResult?.stdout,
            stderr: msg.toolUseResult?.stderr,
          };
        }
      }
    }
    // 다음 assistant 메시지가 나오면 탐색 중단
    if (msg.role === "assistant") break;
  }
  return undefined;
}

function renderAssistantContent(content: ContentBlock[], messages: ChatMessage[], msgIndex: number) {
  return content.map((block, i) => {
    if (block.type === "text") {
      return <MarkdownRenderer key={i} content={block.text} />;
    }
    if (block.type === "tool_use") {
      const tool = block as ToolUseBlock;
      const result = findToolResult(tool.id, messages, msgIndex);
      return <ToolUsePanel key={i} tool={tool} result={result} />;
    }
    return null;
  });
}

function MessageBubble({ msg, index, messages }: { msg: ChatMessage; index: number; messages: ChatMessage[] }) {
  // tool_result를 가진 user 메시지는 ToolUsePanel에서 이미 처리하므로 숨긴다
  if (msg.role === "user" && msg.content.some((b) => b.type === "tool_result")) {
    return null;
  }

  const isUser = msg.role === "user";

  return (
    <div className={`max-w-4xl mx-auto ${isUser ? "flex justify-end" : ""}`}>
      <div
        className={`rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white max-w-[80%]"
            : "bg-zinc-800 text-zinc-100 w-full"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">
            {msg.content.map((b, i) => (b.type === "text" ? <span key={i}>{b.text}</span> : null))}
          </div>
        ) : (
          renderAssistantContent(msg.content, messages, index)
        )}
      </div>
    </div>
  );
}

export default function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const streamingText = useChatStore((s) => s.streamingText);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const usage = useChatStore((s) => s.usage);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-zinc-500">
            메시지를 입력하여 대화를 시작하세요.
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={msg.id} msg={msg} index={i} messages={messages} />
        ))}

        {streamingText && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-zinc-800 text-zinc-100 rounded-lg px-4 py-3 w-full">
              <MarkdownRenderer content={streamingText} />
              <span className="inline-block w-2 h-4 bg-blue-400 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {usage.totalCostUsd > 0 && (
        <div className="border-t border-zinc-700 px-4 py-1.5 text-xs text-zinc-500 flex gap-4 justify-center">
          <span>입력: {usage.inputTokens.toLocaleString()}</span>
          <span>출력: {usage.outputTokens.toLocaleString()}</span>
          <span>캐시: {usage.cacheReadTokens.toLocaleString()}</span>
          <span>비용: ${usage.totalCostUsd.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}
```

### Step 2-6: Phase 2 확인

```bash
pnpm dev
```

**확인 사항:**
1. 마크다운 응답 (헤딩, 리스트, 코드 블록, 테이블)이 정상 렌더링되는지
2. 코드 블록에 구문 하이라이팅이 적용되는지
3. 도구 사용 시 접기/펼치기 패널이 나타나는지
4. 도구 실행 결과가 패널 안에 표시되는지

---

## Phase 3-4: 통합 확인

Phase 1-2를 완성하면 다음 기능이 모두 동작해야 한다:

- [x] 기본 채팅 (스트리밍 응답)
- [x] 마크다운 렌더링 + 코드 하이라이팅
- [x] 도구 사용 패널 (접기/펼치기)
- [x] 세션 목록 (사이드바)
- [x] 세션 이어하기 (클릭하여 히스토리 로드 + resume)
- [x] 새 대화 / 세션 삭제
- [x] 모델 선택
- [x] 프로젝트 디렉토리 변경
- [x] 토큰/비용 표시
- [x] 중단(abort) 버튼
- [x] WebSocket 자동 재연결

위 기능들은 Phase 1-2의 코드에 이미 모두 포함되어 있다.
되돌리기(rewind)는 추후 `--fork-session` 동작 검증 후 추가한다.

---

## 테스트 체크리스트

구현 완료 후 아래 시나리오를 순서대로 수동 테스트한다.

### 기본 대화

- [ ] T1: "1+1은?" 전송 → 스트리밍 응답 표시, 비용 표시
- [ ] T2: 긴 응답 요청 → 자동 스크롤
- [ ] T3: 마크다운 포함 응답 → 코드 블록, 테이블 등 렌더링
- [ ] T4: 연속 메시지 전송 → 정상 동작
- [ ] T5: 빈 메시지 → 전송 차단

### 도구 사용

- [ ] T6: "package.json 읽어줘" → Read 도구 패널 표시
- [ ] T7: "git status 실행해줘" → Bash 도구 패널 + 결과
- [ ] T8: 여러 도구 연쇄 사용 → 패널 순서 표시, 접기/펼치기

### 세션 관리

- [ ] T9: 새 대화 → 채팅 초기화, 세션 목록에 추가
- [ ] T10: 세션 클릭 → 히스토리 로드 (메시지 + 도구 사용)
- [ ] T11: 세션 이어서 대화 → 맥락 유지 확인
- [ ] T12: 세션 삭제 → 목록에서 제거

### 설정

- [ ] T13: 모델 변경 후 질문 → 변경된 모델로 응답
- [ ] T14: 디렉토리 변경 → 세션 목록 갱신, 파일 접근 확인
- [ ] T15: 잘못된 디렉토리 → 경고 표시

### 중단 및 에러

- [ ] T16: 응답 중 중단 버튼 → 즉시 중단, 이후 새 메시지 정상
- [ ] T17: 브라우저 새로고침 → 세션 목록 유지
- [ ] T18: WebSocket 끊김 → 녹색 점 → 빨간 점, 자동 재연결

### UI

- [ ] T19: 긴 URL 표시 → 줄바꿈 처리
- [ ] T20: Shift+Enter → 여러 줄 입력
- [ ] T21: 한글/특수문자 → 정상 표시
- [ ] T22: 창 크기 변경 → 레이아웃 깨지지 않음
