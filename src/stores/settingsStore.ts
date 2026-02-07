import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  model: string;
  cwd: string;
  connected: boolean;

  setModel: (m: string) => void;
  setCwd: (c: string) => void;
  setConnected: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      model: "opus",
      cwd: "C:\\Users\\kim\\Desktop\\projects",
      connected: false,

      setModel: (m) => set({ model: m }),
      setCwd: (c) => set({ cwd: c }),
      setConnected: (v) => set({ connected: v }),
    }),
    {
      name: "claude-web-ui-settings",
      partialize: (state) => ({ model: state.model, cwd: state.cwd }),
    }
  )
);
