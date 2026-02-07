import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { ClaudeCliManager } from "./claude-cli";
import { listSessions, getSessionMessages, deleteSession } from "./session-reader";
import { listProjects } from "./path-encoder";
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

app.get("/api/projects", (_req, res) => {
  const projects = listProjects();
  res.json({ projects });
});

app.get("/api/sessions", async (req, res) => {
  const cwd = req.query.cwd as string;
  if (!cwd) { res.status(400).json({ error: "cwd 파라미터 필요" }); return; }
  const sessions = await listSessions(cwd);
  res.json({ sessions });
});

app.get("/api/sessions/:id/messages", async (req, res) => {
  const cwd = req.query.cwd as string;
  if (!cwd) { res.status(400).json({ error: "cwd 파라미터 필요" }); return; }
  const messages = await getSessionMessages(cwd, req.params.id);
  res.json({ messages });
});

app.delete("/api/sessions/:id", async (req, res) => {
  const cwd = req.query.cwd as string;
  if (!cwd) { res.status(400).json({ error: "cwd 파라미터 필요" }); return; }
  const deleted = await deleteSession(cwd, req.params.id);
  res.json({ deleted });
});

app.get("/api/settings", (_req, res) => {
  ensureConfigDir();
  if (fs.existsSync(settingsPath)) {
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    res.json(data);
  } else {
    res.json({ model: "opus", cwd: process.cwd() });
  }
});

app.post("/api/settings", (req, res) => {
  ensureConfigDir();
  fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.get("/api/directories/recent", (_req, res) => {
  ensureConfigDir();
  if (fs.existsSync(recentDirsPath)) {
    const data = JSON.parse(fs.readFileSync(recentDirsPath, "utf-8"));
    res.json(data);
  } else {
    res.json({ directories: [] });
  }
});

app.post("/api/directories/validate", (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) { res.status(400).json({ valid: false, error: "경로 필요" }); return; }
  const valid = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  res.json({ valid });
});

function addRecentDir(dirPath: string): void {
  ensureConfigDir();
  let dirs: string[] = [];
  if (fs.existsSync(recentDirsPath)) {
    const data = JSON.parse(fs.readFileSync(recentDirsPath, "utf-8"));
    dirs = data.directories || [];
  }
  dirs = [dirPath, ...dirs.filter((d: string) => d !== dirPath)].slice(0, 20);
  fs.writeFileSync(recentDirsPath, JSON.stringify({ directories: dirs }, null, 2));
}

// --- WebSocket ---

const managers = new Map<string, ClaudeCliManager>();

io.on("connection", (socket) => {
  console.log(`[socket.io] 클라이언트 연결: ${socket.id}`);

  const manager = new ClaudeCliManager();
  managers.set(socket.id, manager);

  manager.on("data", (event: unknown) => {
    socket.emit("stream", event);
  });

  manager.on("error", (msg: string) => {
    socket.emit("error", { message: msg, code: "PROCESS_ERROR" });
  });

  manager.on("exit", (code: number | null) => {
    socket.emit("exit", { code });
  });

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

  socket.on("abort", () => {
    manager.abort();
  });

  socket.on("disconnect", () => {
    console.log(`[socket.io] 클라이언트 연결 해제: ${socket.id}`);
    manager.abort();
    managers.delete(socket.id);
  });
});

// --- 서버 시작 ---
const PORT = 3001;
httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`[서버] WebSocket + REST 서버 시작: http://127.0.0.1:${PORT}`);
});
