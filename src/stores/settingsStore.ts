import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  model: string;
  cwd: string;
  connected: boolean;
  recentProjects: string[];

  setModel: (m: string) => void;
  setCwd: (c: string) => void;
  setConnected: (v: boolean) => void;
  touchProject: (path: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      model: "opus",
      cwd: "C:\\Users\\kim\\Desktop\\projects",
      connected: false,
      recentProjects: [],

      setModel: (m) => set({ model: m }),
      setCwd: (c) => set({ cwd: c }),
      setConnected: (v) => set({ connected: v }),
      touchProject: (p) => {
        const prev = get().recentProjects.filter((r) => r !== p);
        set({ recentProjects: [p, ...prev].slice(0, 30) });
      },
    }),
    {
      name: "claude-web-ui-settings",
      partialize: (state) => ({
        model: state.model,
        cwd: state.cwd,
        recentProjects: state.recentProjects,
      }),
    }
  )
);
