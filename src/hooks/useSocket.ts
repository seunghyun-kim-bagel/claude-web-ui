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
