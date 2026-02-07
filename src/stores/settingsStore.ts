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
