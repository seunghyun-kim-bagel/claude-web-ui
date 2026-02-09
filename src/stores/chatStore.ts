import { create } from "zustand";

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
  uuid?: string; // CLI 세션 JSONL의 uuid (rewind용)
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
  streamingText: string;
  sessionId: string | null;
  usage: UsageInfo;
  queuedMessages: string[];

  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  appendStreamingText: (text: string) => void;
  clearStreamingText: () => void;
  setIsStreaming: (v: boolean) => void;
  setSessionId: (id: string | null) => void;
  setUsage: (u: Partial<UsageInfo>) => void;
  enqueueMessage: (msg: string) => void;
  dequeueMessage: () => string | undefined;
  rewindToMessage: (messageId: string) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingText: "",
  sessionId: null,
  queuedMessages: [],
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
  enqueueMessage: (msg) => set((s) => ({ queuedMessages: [...s.queuedMessages, msg] })),
  dequeueMessage: () => {
    const queue = get().queuedMessages;
    if (queue.length === 0) return undefined;
    const [first, ...rest] = queue;
    set({ queuedMessages: rest });
    return first;
  },
  rewindToMessage: (messageId: string) => {
    const msgs = get().messages;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    set({
      messages: msgs.slice(0, idx),
      streamingText: "",
      isStreaming: false,
      queuedMessages: [],
    });
  },
  clearChat: () =>
    set({
      messages: [],
      streamingText: "",
      isStreaming: false,
      sessionId: null,
      queuedMessages: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalCostUsd: 0,
      },
    }),
}));
