import {
  Save,
  FolderOpen,
  PanelLeft,
  PanelBottom,
  PanelRight,
  SunMoon,
  Maximize,
  LayoutGrid,
  Plus,
  Settings,
  Plug,
  GitCommit,
  Compass,
  Table2,
  ListChecks,
  Waypoints,
  Text,
  Map,
  Magnet,
  Eye,
  Database,
} from "lucide-react";
import useUiStore from "../stores/uiStore";
import useDiagramStore from "../stores/diagramStore";
import useWorkspaceStore from "../stores/workspaceStore";

// Command descriptor: { id, title, section, shortcut?, icon?, keywords?, run }
export function buildCommands() {
  const ui = useUiStore.getState();
  const diagram = useDiagramStore.getState();
  const workspace = useWorkspaceStore.getState();
  const settings = ui.userSettings || {};

  const cmds = [
    // File
    {
      id: "file.save",
      title: "Save model",
      section: "File",
      shortcut: "⌘S",
      icon: Save,
      run: () => workspace.saveCurrentFile?.() || workspace.saveActiveFile?.(),
    },
    {
      id: "file.open-project",
      title: "Open project…",
      section: "File",
      icon: FolderOpen,
      run: () => ui.openModal("addProject"),
    },

    // Create
    {
      id: "create.entity",
      title: "New entity…",
      section: "Create",
      icon: Table2,
      keywords: "table add",
      run: () => ui.openModal("newEntity", { type: "table" }),
    },
    {
      id: "create.enum",
      title: "New enum…",
      section: "Create",
      icon: ListChecks,
      run: () => ui.openModal("newEntity", { type: "enum" }),
    },
    {
      id: "create.relationship",
      title: "New relationship…",
      section: "Create",
      icon: Waypoints,
      run: () => ui.openModal("newRelationship"),
    },
    {
      id: "create.diagram",
      title: "New diagram…",
      section: "Create",
      icon: LayoutGrid,
      run: () => {
        const name = window.prompt(
          "New diagram name",
          `Diagram ${(diagram.diagrams?.length || 0) + 1}`
        );
        if (name && name.trim()) diagram.addDiagram(name.trim());
      },
    },

    // Diagram
    {
      id: "diagram.fit",
      title: "Fit diagram",
      section: "Diagram",
      shortcut: "⇧F",
      icon: Maximize,
      run: () => diagram.requestFitDiagram(),
    },
    {
      id: "diagram.relayout",
      title: "Auto-layout diagram",
      section: "Diagram",
      icon: LayoutGrid,
      run: () => diagram.requestLayoutRefresh(),
    },

    // View
    {
      id: "view.toggle-sidebar",
      title: "Toggle sidebar",
      section: "View",
      shortcut: "⌘\\",
      icon: PanelLeft,
      run: () => ui.toggleSidebar(),
    },
    {
      id: "view.toggle-bottom-panel",
      title: "Toggle bottom panel",
      section: "View",
      shortcut: "⌘J",
      icon: PanelBottom,
      run: () => ui.toggleBottomPanel(),
    },
    {
      id: "view.toggle-right-panel",
      title: "Toggle inspector",
      section: "View",
      icon: PanelRight,
      run: () => ui.toggleRightPanel?.(),
    },
    {
      id: "view.toggle-theme",
      title: `Switch to ${ui.theme === "dark" ? "light" : "dark"} mode`,
      section: "View",
      shortcut: "⌘D",
      icon: SunMoon,
      run: () => ui.toggleTheme(),
    },

    // Preferences (live toggles, reflect current state in title)
    {
      id: "pref.word-wrap",
      title: `${settings.editor?.wordWrap ? "Disable" : "Enable"} word wrap`,
      section: "Preferences",
      icon: Text,
      run: () =>
        ui.updateUserSetting?.("editor", "wordWrap", !settings.editor?.wordWrap),
    },
    {
      id: "pref.minimap",
      title: `${settings.canvas?.showMinimap ? "Hide" : "Show"} minimap`,
      section: "Preferences",
      icon: Map,
      run: () =>
        ui.updateUserSetting?.("canvas", "showMinimap", !settings.canvas?.showMinimap),
    },
    {
      id: "pref.snap",
      title: `${settings.canvas?.snapToGrid ? "Disable" : "Enable"} snap to grid`,
      section: "Preferences",
      icon: Magnet,
      run: () =>
        ui.updateUserSetting?.("canvas", "snapToGrid", !settings.canvas?.snapToGrid),
    },

    // Settings
    {
      id: "settings.open",
      title: "Open settings",
      section: "Settings",
      icon: Settings,
      run: () => ui.openModal("settings"),
    },
    {
      id: "settings.connections",
      title: "Open connections manager",
      section: "Settings",
      icon: Plug,
      run: () => ui.openModal("connectionsManager"),
    },

    // Git
    {
      id: "git.commit",
      title: "Commit changes…",
      section: "Git",
      icon: GitCommit,
      run: () => ui.openModal("commit"),
    },

    // Navigate
    {
      id: "activity.model",
      title: "Go to Model",
      section: "Navigate",
      shortcut: "⌘1",
      icon: Database,
      run: () => ui.setActiveActivity("model"),
    },
    {
      id: "activity.connect",
      title: "Go to Connect",
      section: "Navigate",
      shortcut: "⌘2",
      icon: Plug,
      run: () => ui.setActiveActivity("connect"),
    },
    {
      id: "activity.search",
      title: "Go to Search",
      section: "Navigate",
      icon: Compass,
      run: () => ui.setActiveActivity("search"),
    },
  ];

  // Entity jumps — centers the selected entity on the canvas
  const entities = diagram.model?.entities || [];
  for (const e of entities) {
    cmds.push({
      id: `goto.entity.${e.name}`,
      title: `Go to entity: ${e.name}`,
      section: "Go to",
      icon: Table2,
      keywords: `${e.type || ""} ${e.subject_area || ""}`.trim(),
      run: () => {
        diagram.selectEntity(e.name);
        diagram.setCenterEntityId(e.name);
      },
    });
  }

  // Enum jumps
  for (const en of diagram.model?.enums || []) {
    cmds.push({
      id: `goto.enum.${en.name}`,
      title: `Go to enum: ${en.name}`,
      section: "Go to",
      icon: ListChecks,
      run: () => {
        ui.setSelection?.({ kind: "enum", enumName: en.name });
        if (!ui.rightPanelOpen) ui.toggleRightPanel?.();
      },
    });
  }

  // Diagram switches
  for (const d of diagram.diagrams || []) {
    cmds.push({
      id: `diagram.switch.${d.id}`,
      title: `Switch to diagram: ${d.name}`,
      section: "Diagram",
      icon: LayoutGrid,
      run: () => diagram.selectDiagram(d.id),
    });
  }

  // Project switches
  for (const p of workspace.openProjects || []) {
    const project = (workspace.projects || []).find((x) => x.id === p);
    if (!project) continue;
    cmds.push({
      id: `project.switch.${p}`,
      title: `Switch to project: ${project.name || p}`,
      section: "Project",
      icon: FolderOpen,
      run: () => workspace.selectProject(p),
    });
  }

  return cmds;
}

export function fuzzyMatch(query, text, keywords = "") {
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0 };
  const haystack = `${text} ${keywords || ""}`.toLowerCase();
  if (haystack.includes(q)) {
    const idx = haystack.indexOf(q);
    return { score: 100 - idx };
  }
  let qi = 0;
  let score = 0;
  for (let i = 0; i < haystack.length && qi < q.length; i++) {
    if (haystack[i] === q[qi]) {
      score += 1;
      qi++;
    }
  }
  return qi === q.length ? { score } : null;
}
