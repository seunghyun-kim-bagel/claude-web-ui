"use client";

import { useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket-client";
import { useChatStore, ChatMessage, ContentBlock } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";

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
  uuid?: string;
}

interface UserEvent {
  type: "user";
  message: {
    content: ContentBlock[];
  };
  uuid?: string;
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

function processQueue(socketRef: React.RefObject<Socket | null>) {
  const chatState = useChatStore.getState();
  if (chatState.isStreaming) return;
  const next = chatState.dequeueMessage();
  if (next && socketRef.current) {
    // 큐에서 꺼낸 시점에 유저 버블 추가 (실제 전송 순서 = 화면 순서)
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: [{ type: "text", text: next }],
      timestamp: new Date().toISOString(),
    };
    chatState.addMessage(userMsg);

    const settingsState = useSettingsStore.getState();
    chatState.setIsStreaming(true);
    socketRef.current.emit("send_message", {
      message: next,
      session_id: chatState.sessionId,
      model: settingsState.model,
      cwd: settingsState.cwd,
    });
  }
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

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
      switch (event.type) {
        case "system":
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
          useChatStore.getState().clearStreamingText();

          const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantEvt.message.content,
            timestamp: new Date().toISOString(),
            uuid: assistantEvt.uuid,
          };
          useChatStore.getState().addMessage(msg);

          if (assistantEvt.session_id) {
            useChatStore.getState().setSessionId(assistantEvt.session_id);
          }
          break;
        }

        case "user": {
          const userEvt = event as UserEvent;
          const toolMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: userEvt.message.content as ContentBlock[],
            timestamp: new Date().toISOString(),
            uuid: userEvt.uuid,
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
          // processQueue는 exit 이벤트에서만 호출 (서버 busy 상태 방지)
          break;
        }
      }
    });

    socket.on("cli_error", (data: { message: string; code: string }) => {
      console.error("[socket.io] CLI 에러:", data);
      useChatStore.getState().setIsStreaming(false);
      setTimeout(() => processQueue(socketRef), 100);
    });

    socket.on("busy", (data: { message: string }) => {
      console.warn("[socket.io] busy:", data.message);
    });

    socket.on("exit", (data: { code: number | null }) => {
      useChatStore.getState().setIsStreaming(false);
      useChatStore.getState().clearStreamingText();
      // Windows에서 taskkill /F 강제종료 시 0xC0000142 등의 코드 발생 — 정상 중단
      const forceKillCodes = [3221225794, 3221225786, 1];
      if (data.code !== 0 && data.code !== null && !forceKillCodes.includes(data.code)) {
        console.error("[socket.io] CLI 비정상 종료, code:", data.code);
      }
      // exit 이벤트에서도 대기열 처리
      setTimeout(() => processQueue(socketRef), 100);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("stream");
      socket.off("cli_error");
      socket.off("busy");
      socket.off("exit");
    };
  }, []);

  const sendMessage = useCallback((message: string) => {
    const chatState = useChatStore.getState();

    if (chatState.isStreaming) {
      // 스트리밍 중이면 대기열에만 추가 (버블은 processQueue에서 전송 시 표시)
      chatState.enqueueMessage(message);
    } else {
      // 즉시 전송: 유저 버블 추가 후 전송
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: [{ type: "text", text: message }],
        timestamp: new Date().toISOString(),
      };
      chatState.addMessage(userMsg);

      const settingsState = useSettingsStore.getState();
      chatState.setIsStreaming(true);
      socketRef.current?.emit("send_message", {
        message,
        session_id: chatState.sessionId,
        model: settingsState.model,
        cwd: settingsState.cwd,
      });
    }
  }, []);

  const abort = useCallback(() => {
    socketRef.current?.emit("abort");
  }, []);

  const rewind = useCallback(async (messageId: string, userTurnIndex: number): Promise<boolean> => {
    const chatState = useChatStore.getState();
    const settingsState = useSettingsStore.getState();

    // 진행 중인 스트리밍 중단
    if (chatState.isStreaming) {
      socketRef.current?.emit("abort");
    }

    if (!chatState.sessionId) return false;

    try {
      const res = await fetch(
        `http://localhost:3001/api/sessions/${chatState.sessionId}/rewind?cwd=${encodeURIComponent(settingsState.cwd)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userTurnIndex }),
        }
      );
      const data = await res.json();
      if (data.ok) {
        chatState.rewindToMessage(messageId);
        return true;
      }
      return false;
    } catch (err) {
      console.error("[rewind] 실패:", err);
      return false;
    }
  }, []);

  return { sendMessage, abort, rewind };
}
