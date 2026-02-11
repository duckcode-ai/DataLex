import { create } from "zustand";

const useUiStore = create((set) => ({
  // Sidebar
  sidebarOpen: true,
  sidebarWidth: 260,

  // Theme
  theme: localStorage.getItem("dm_theme") || "light", // "light" | "dark"

  // Active view
  activeView: "modeling", // modeling | validation | diff | impact

  // Bottom panel
  bottomPanelOpen: true,
  bottomPanelTab: "properties", // properties | validation | diff | impact | history

  // Right panel (entity properties)
  rightPanelOpen: false,

  // Diagram fullscreen
  diagramFullscreen: false,

  // Modals
  activeModal: null, // "addProject" | "newFile" | "settings" | null

  // Notifications
  toasts: [],

  // --- Actions ---
  toggleTheme: () => set((s) => {
    const next = s.theme === "light" ? "dark" : "light";
    localStorage.setItem("dm_theme", next);
    document.documentElement.setAttribute("data-theme", next);
    return { theme: next };
  }),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setActiveView: (view) => set({ activeView: view }),

  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleDiagramFullscreen: () => set((s) => ({ diagramFullscreen: !s.diagramFullscreen })),
  setDiagramFullscreen: (open) => set({ diagramFullscreen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast_${Date.now()}`;
    const entry = { id, ...toast };
    set((s) => ({ toasts: [...s.toasts, entry] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, toast.duration || 4000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export default useUiStore;
