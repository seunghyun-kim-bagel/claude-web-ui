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

interface Project {
  encoded: string;
  path: string;
  name: string;
  sessionCount: number;
}

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const cwd = useSettingsStore((s) => s.cwd);
  const setCwd = useSettingsStore((s) => s.setCwd);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:3001/api/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch {
      console.error("프로젝트 목록 로드 실패");
    }
  }, []);

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
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (!isStreaming) {
      fetchSessions();
    }
  }, [isStreaming, fetchSessions]);

  const handleProjectChange = (newCwd: string) => {
    setCwd(newCwd);
    useChatStore.getState().clearChat();
  };

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
      <div className="p-3 border-b border-zinc-700 space-y-2">
        <select
          value={cwd}
          onChange={(e) => handleProjectChange(e.target.value)}
          className="w-full bg-zinc-800 text-zinc-200 text-sm border border-zinc-600 rounded px-2 py-1.5 truncate"
          title={cwd}
        >
          {projects.map((p) => (
            <option key={p.encoded} value={p.path}>
              {p.name} ({p.sessionCount})
            </option>
          ))}
          {!projects.some((p) => p.path === cwd) && (
            <option value={cwd}>{cwd}</option>
          )}
        </select>
        <button
          onClick={handleNewChat}
          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors"
        >
          + 새 대화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="px-3 py-4 text-xs text-zinc-500 text-center">
            세션이 없습니다
          </div>
        )}
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
