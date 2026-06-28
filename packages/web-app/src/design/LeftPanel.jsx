/* Left panel — Object List / Explorer / Themes. Ported from DataLex design prototype.
 *
 * The EXPLORER tab renders the active project's file tree. We build it on the
 * fly with `buildFileTree` (pure, memo-friendly) so adding a file anywhere in
 * the store is reflected on next render without tree-state bookkeeping here.
 * Folder fold/unfold is local component state, keyed by slash-joined folder
 * path — that key survives tree rebuilds because paths don't change when a
 * sibling file is added or removed.
 */
import React from "react";
import Icon from "./icons";
import { buildFileTree, countFiles } from "../lib/fileTree";
import useWorkspaceStore from "../stores/workspaceStore";
import useUiStore from "../stores/uiStore";
import ExplorerContextMenu from "../components/panels/ExplorerContextMenu";
import { PanelLeftClose } from "lucide-react";

function filterTreeNodes(nodes, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return nodes || [];
  const visit = (items) => {
    const out = [];
    for (const node of items || []) {
      if (node.kind === "folder") {
        const children = visit(node.children || []);
        const selfMatch = String(node.name || "").toLowerCase().includes(needle)
          || String(node.path || "").toLowerCase().includes(needle);
        if (selfMatch || children.length > 0) {
          out.push({ ...node, children });
        }
      } else {
        const haystack = `${node.name || ""} ${node.path || ""}`.toLowerCase();
        if (haystack.includes(needle)) out.push(node);
      }
    }
    return out;
  };
  return visit(nodes || []);
}

function artifactMeta(path, name, kind = "file") {
  const p = String(path || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  const isDiagramConceptual = /^diagrams\/conceptual(\/|$)/.test(p);
  const isDiagramLogical = /^diagrams\/logical(\/|$)/.test(p);
  const isDiagramPhysical = /^diagrams\/physical(\/|$)/.test(p);
  const isModelConceptual = /^models\/conceptual(\/|$)/.test(p);
  const isModelLogical = /^models\/logical(\/|$)/.test(p);
  const isModelPhysical = /^models\/physical(\/|$)/.test(p);
  const isGeneratedDbt = /^generated-sql\//.test(p) || /^generated\/dbt(\/|$)/.test(p) || /^datalex\/generated\/dbt(\/|$)/.test(p);
  if (kind === "folder") {
    if (isDiagramConceptual) return { tone: "conceptual", label: "conceptual", icon: "diagram" };
    if (isDiagramLogical) return { tone: "logical", label: "logical", icon: "diagram" };
    if (isDiagramPhysical) return { tone: "physical", label: "physical", icon: "diagram" };
    if (isModelConceptual) return { tone: "conceptual", label: "conceptual", icon: "folder" };
    if (isModelLogical) return { tone: "logical", label: "logical", icon: "folder" };
    if (isModelPhysical) return { tone: "physical", label: "physical", icon: "folder" };
    if (isGeneratedDbt) return { tone: "dbt", label: "generated", icon: "dbt" };
    if (p === "datalex" || p.startsWith("datalex/")) return { tone: "diagram", label: "DataLex", icon: "folder" };
    if (p.includes("conceptual")) return { tone: "conceptual", label: "conceptual", icon: "folder" };
    if (p.includes("logical")) return { tone: "logical", label: "logical", icon: "folder" };
    if (p.includes("physical")) return { tone: "physical", label: "physical", icon: "folder" };
    if (p === "models" || p.startsWith("models/")) return { tone: "models", label: "models", icon: "folder" };
    if (p === "diagrams" || p.startsWith("diagrams/") || p.endsWith("diagrams")) return { tone: "diagram", label: "diagrams", icon: "diagram" };
    if (p.startsWith("semantic")) return { tone: "semantic", label: "semantic", icon: "semantic" };
    if (p.startsWith("relationships")) return { tone: "relationship", label: "relationships", icon: "relationship" };
    if (p.startsWith("data_types")) return { tone: "datatype", label: "types", icon: "datatype" };
    return { tone: "folder", label: "", icon: "folder" };
  }
  if (/\.diagram\.ya?ml$/i.test(n)) {
    if (isDiagramConceptual) return { tone: "conceptual", label: "diagram", icon: "diagram" };
    if (isDiagramLogical) return { tone: "logical", label: "diagram", icon: "diagram" };
    if (isDiagramPhysical) return { tone: "physical", label: "diagram", icon: "diagram" };
    return { tone: "diagram", label: "diagram", icon: "diagram" };
  }
  if (isGeneratedDbt && /\.sql$/i.test(n)) return { tone: "dbt", label: "sql", icon: "dbt" };
  if (isGeneratedDbt && /\.ya?ml$/i.test(n)) return { tone: "dbt", label: "dbt", icon: "dbt" };
  if (p.includes("/conceptual/")) return { tone: "conceptual", label: "concept", icon: "entity" };
  if (p.includes("/logical/")) return { tone: "logical", label: "logical", icon: "entity" };
  if (p.includes("/physical/")) return { tone: "physical", label: "physical", icon: "entity" };
  if (p.startsWith("semantic/")) return { tone: "semantic", label: "semantic", icon: "semantic" };
  if (p.startsWith("relationships/")) return { tone: "relationship", label: "relation", icon: "relationship" };
  if (p.startsWith("data_types/")) return { tone: "datatype", label: "type", icon: "datatype" };
  if (n === "dbt_project.yml" || n === "dbt_project.yaml" || n === "schema.yml" || n === "schema.yaml" || p.includes("/schema.y")) {
    return { tone: "dbt", label: "dbt", icon: "dbt" };
  }
  if (/\.ya?ml$/i.test(n) && /^(models|seeds|snapshots|analyses|macros)\//i.test(p)) {
    return { tone: "dbt", label: "dbt", icon: "dbt" };
  }
  return { tone: "file", label: "yaml", icon: "entity" };
}

function ArtifactIcon({ I, meta }) {
  const key = meta?.icon || "entity";
  if (key === "diagram") return <I.Layers />;
  if (key === "relationship") return <I.Relation />;
  if (key === "datatype") return <I.Enum />;
  if (key === "semantic") return <I.View />;
  if (key === "dbt") return <I.Dep />;
  if (key === "folder") return <I.Folder />;
  return <I.Table />;
}

function reviewBadgeMeta(review) {
  const status = String(review?.status || "").toLowerCase();
  if (status === "red") return { color: "#ef4444", label: `${review.score ?? 0} readiness score - red` };
  if (status === "yellow") return { color: "#f59e0b", label: `${review.score ?? 0} readiness score - yellow` };
  if (status === "green") return { color: "#10b981", label: `${review.score ?? 100} readiness score - green` };
  return null;
}

function ReadinessBadge({ review }) {
  const meta = reviewBadgeMeta(review);
  if (!meta) return null;
  const total = Number(review?.counts?.total || 0);
  return (
    <span
      title={`${meta.label}${total ? ` · ${total} finding${total === 1 ? "" : "s"}` : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        minWidth: 28,
        height: 16,
        borderRadius: 4,
        border: "1px solid var(--border-default)",
        background: "var(--bg-2)",
        color: "var(--text-secondary)",
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
      {review.score ?? ""}
    </span>
  );
}

function flattenFolderOptions(nodes, moving = null) {
  const movingPath = String(moving?.path || "").replace(/\/+$/g, "");
  const out = [{ path: "", label: "DataLex root" }];
  const visit = (items) => {
    for (const node of items || []) {
      if (node.kind !== "folder") continue;
      const path = String(node.path || "").replace(/\/+$/g, "");
      const isSelfOrChild = moving?.target === "folder" && (
        path === movingPath || path.startsWith(`${movingPath}/`)
      );
      if (!isSelfOrChild) {
        out.push({ path, label: path });
        visit(node.children || []);
      }
    }
  };
  visit(nodes || []);
  return out;
}

function basenameFromPath(path) {
  return String(path || "").replace(/\/+$/g, "").split("/").filter(Boolean).pop() || "";
}

function joinExplorerPath(parent, name) {
  const base = String(parent || "").replace(/^\/+|\/+$/g, "");
  const clean = String(name || "").replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${clean}` : clean;
}

function MoveExplorerItemDialog({ moveState, folders, onClose, onMove }) {
  const [destination, setDestination] = React.useState("");
  const [name, setName] = React.useState(() => basenameFromPath(moveState?.path));
  const [filter, setFilter] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    setDestination("");
    setName(basenameFromPath(moveState?.path));
    setFilter("");
    setBusy(false);
    setError("");
  }, [moveState]);
  if (!moveState) return null;
  const filteredFolders = folders.filter((folder) => {
    const haystack = `${folder.label} ${folder.path}`.toLowerCase();
    return !filter || haystack.includes(filter.toLowerCase());
  });
  const targetPath = joinExplorerPath(destination, name);
  const canMove = targetPath && targetPath !== moveState.path && !busy;
  const submit = async () => {
    if (!canMove) return;
    setBusy(true);
    setError("");
    try {
      await onMove(moveState, targetPath);
      onClose();
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  };
  return (
    <div className="dlx-modal-overlay move-explorer-overlay" role="presentation" onMouseDown={onClose}>
      <div className="dlx-modal-card md move-explorer-card" role="dialog" aria-modal="true" aria-label="Move workspace item" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlx-modal-header">
          <div className="dlx-modal-title-group">
            <div className="dlx-modal-icon">↗</div>
            <div>
              <div className="dlx-modal-title">Move {moveState.target === "folder" ? "Folder" : "File"}</div>
              <div className="dlx-modal-subtitle">{moveState.path}</div>
            </div>
          </div>
          <button className="dlx-modal-close" type="button" onClick={onClose}>×</button>
        </div>
        <div className="dlx-modal-body loose">
          <label className="dlx-modal-field-label">
            Destination folder
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search folders..."
              autoFocus
            />
          </label>
          <div className="move-explorer-folder-list">
            {filteredFolders.map((folder) => (
              <button
                key={folder.path || "__root__"}
                type="button"
                className={`move-explorer-folder ${destination === folder.path ? "active" : ""}`}
                onClick={() => setDestination(folder.path)}
              >
                <span>{folder.path ? folder.label : "DataLex root"}</span>
                {destination === folder.path && <strong>Selected</strong>}
              </button>
            ))}
          </div>
          <label className="dlx-modal-field-label">
            Name after move
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="file-or-folder-name" />
          </label>
          <div className="move-explorer-preview">
            <span>Destination</span>
            <code>{targetPath || "(choose a destination)"}</code>
          </div>
          {error && <div className="dlx-modal-alert warn">{error}</div>}
        </div>
        <div className="dlx-modal-footer">
          <button type="button" className="panel-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="panel-btn primary" onClick={submit} disabled={!canMove}>
            {busy ? "Moving..." : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeftPanel({ activeTable, onSelectTable, tables, theme, setTheme, subjectAreas = [], connectionLabel = "workspace", connectionDsn = "", schemas = [], onAddEntity, projects = [], activeProjectId = null, onSelectProject = null }) {
  const I = Icon;
  const [tab, setTab] = React.useState("EXPLORER");
  const setLeftPanelOpen = useUiStore((s) => s.setLeftPanelOpen);
  const [query, setQuery] = React.useState("");
  const [explorerQuery, setExplorerQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState({});
  const toggle = (k) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));

  /* Explorer: pull the file list + open-file action from the store directly.
     LeftPanel already subscribes to the shell's theme / tables props, and the
     explorer tree is self-contained — no need to thread two more props
     through Shell.jsx just to reach the workspace. */
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const optimisticFolders = useWorkspaceStore((s) => s.optimisticFolders);
  const activeFullPath = useWorkspaceStore((s) => s.activeFile?.fullPath || "");
  const offlineMode = useWorkspaceStore((s) => s.offlineMode);
  // Note: `activeProjectId` comes from props (threaded from Shell) — don't
  // re-subscribe here or it shadows the prop. Use prop directly below.
  // `switchTab` branches on offline vs api-backed mode internally — so a user
  // who loaded the jaffle-shop demo (offline) and a user with a real project
  // on disk both route through the same click handler.
  const openFile = useWorkspaceStore((s) => s.switchTab);
  const createNewFile = useWorkspaceStore((s) => s.createNewFile);
  const createFolderAction = useWorkspaceStore((s) => s.createFolder);
  const renameFileAction = useWorkspaceStore((s) => s.renameFile);
  const moveFileAction = useWorkspaceStore((s) => s.moveFile);
  const renameFolderAction = useWorkspaceStore((s) => s.renameFolder);
  const deleteFileAction = useWorkspaceStore((s) => s.deleteFile);
  const deleteFolderAction = useWorkspaceStore((s) => s.deleteFolder);
  const dbtReadinessReview = useWorkspaceStore((s) => s.dbtReadinessReview);
  const dbtReadinessLoading = useWorkspaceStore((s) => s.dbtReadinessLoading);
  const runReadinessReview = useWorkspaceStore((s) => s.runDbtReadinessReview);
  const addToast = useUiStore((s) => s.addToast);
  const openModal = useUiStore((s) => s.openModal);
  const openAiPanel = useUiStore((s) => s.openAiPanel);
  const explorerReady = !offlineMode && !!activeProjectId;
  const fileTree = React.useMemo(
    () => buildFileTree(projectFiles || [], optimisticFolders || []),
    [projectFiles, optimisticFolders]
  );
  const filteredFileTree = React.useMemo(
    () => filterTreeNodes(fileTree, explorerQuery),
    [fileTree, explorerQuery]
  );
  const readinessByPath = React.useMemo(() => {
    const by = {};
    const add = (key, file) => {
      const normalized = String(key || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
      if (!normalized || by[normalized]) return;
      by[normalized] = file;
    };
    for (const file of dbtReadinessReview?.files || []) {
      if (!file?.path) continue;
      add(file.path, file);
      add(file.fullPath, file);
      add(file.name, file);
      const parts = String(file.path || "").replace(/\\/g, "/").split("/");
      for (let i = 1; i < parts.length; i += 1) {
        add(parts.slice(i).join("/"), file);
      }
    }
    return by;
  }, [dbtReadinessReview]);

  React.useEffect(() => {
    const onTab = (event) => {
      const next = event?.detail?.tab;
      if (next) setTab(String(next).toUpperCase());
    };
    window.addEventListener("datalex:left-tab", onTab);
    return () => window.removeEventListener("datalex:left-tab", onTab);
  }, []);



  const [folded, setFolded] = React.useState({});
  const toggleFolder = (path) => setFolded((s) => ({ ...s, [path]: !s[path] }));

  // Context menu + drag state. `ctxMenu` is `{x, y, target, path}` or null.
  const [ctxMenu, setCtxMenu] = React.useState(null);
  const [moveState, setMoveState] = React.useState(null);
  const dragStateRef = React.useRef({ path: "", at: 0 });

  const openCtxMenu = React.useCallback((e, target, path) => {
    if (!explorerReady) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, target, path: path || "" });
  }, [explorerReady]);

  const closeCtxMenu = React.useCallback(() => setCtxMenu(null), []);
  const folderOptions = React.useMemo(() => flattenFolderOptions(fileTree, moveState), [fileTree, moveState]);

  // Combine a parent folder path with a child name into a POSIX subpath.
  const joinChild = React.useCallback((parent, name) => {
    const base = String(parent || "").replace(/\/+$/, "");
    const clean = String(name || "").replace(/^\/+|\/+$/g, "");
    return base ? `${base}/${clean}` : clean;
  }, []);

  const handleCtxAction = React.useCallback(async (actionId, menu) => {
    try {
      if (actionId === "ask-ai") {
        openAiPanel({
          source: "explorer",
          targetName: menu.path || "workspace",
          context: {
            kind: menu.target === "file" ? "file" : menu.target === "folder" ? "folder" : "workspace",
            filePath: menu.target === "file" ? menu.path : "",
            folderPath: menu.target === "folder" ? menu.path : "",
          },
        });
      } else if (actionId === "new-file") {
        openModal("newFile", { targetFolder: menu.target === "folder" ? menu.path : "" });
      } else if (actionId === "new-folder") {
        const name = window.prompt("New folder name:", "new_folder");
        if (!name) return;
        const fullRel = joinChild(menu.target === "folder" ? menu.path : "", name);
        await createFolderAction(fullRel);
      } else if (actionId === "new-diagram") {
        openModal("newFile", { artifact: "diagram", targetFolder: menu.target === "folder" ? menu.path : "" });
      } else if (actionId === "dbt-readiness") {
        const scope = menu.target === "file" ? "file" : "all";
        const paths = menu.target === "file" && menu.path ? [menu.path] : [];
        const review = await runReadinessReview({ scope, paths });
        addToast?.({
          type: "success",
          message: `Readiness review complete: ${review.summary.red} red, ${review.summary.yellow} yellow, ${review.summary.green} green.`,
        });
      } else if (actionId === "rename") {
        const current = menu.path || "";
        const next = window.prompt("Rename to (full path from model root):", current);
        if (!next || next === current) return;
        // Phase 3.3 — preview reference-rewrite impact before we actually
        // execute the rename. User sees the list of diagrams + manifests
        // that will be rewritten so there's no surprise cascade.
        const scope = menu.target === "folder" ? "folder" : "file";
        const impact = await useWorkspaceStore.getState().previewRenameImpact(current, next, scope);
        const promptText = useWorkspaceStore.getState().formatRenameImpactPrompt(current, next, impact);
        const proceed = window.confirm(promptText);
        if (!proceed) return;
        if (menu.target === "folder") await renameFolderAction(current, next);
        else await renameFileAction(current, next);
        const cascade = useWorkspaceStore.getState().lastRenameCascade;
        if (cascade?.filesUpdated?.length) {
          addToast({
            type: "info",
            message: `Renamed to "${next}". Rewrote ${cascade.filesUpdated.length} related file${cascade.filesUpdated.length === 1 ? "" : "s"}.`,
          });
        }
        if (cascade?.failures?.length) {
          addToast({
            type: "warning",
            message: `Rename-cascade partially failed (${cascade.failures.length} file${cascade.failures.length === 1 ? "" : "s"}). See console.`,
          });
          console.warn("[datalex] rename-cascade failures:", cascade.failures);
        }
      } else if (actionId === "move") {
        if (!menu.path) return;
        setMoveState({ target: menu.target === "folder" ? "folder" : "file", path: menu.path });
      } else if (actionId === "delete") {
        // Phase 3.4 — preview the cascade before confirming. User sees how
        // many diagrams + relationships will be affected so there's no
        // silent data loss.
        const scope = menu.target === "folder" ? "folder" : "file";
        const impact = await useWorkspaceStore.getState().previewDeleteImpact(menu.path, scope);
        const promptText = useWorkspaceStore.getState().formatDeleteImpactPrompt(menu.path, scope, impact);
        const confirmed = window.confirm(promptText);
        if (!confirmed) return;
        if (scope === "folder") await deleteFolderAction(menu.path);
        else await deleteFileAction(menu.path);
        // Surface the cascade: "also rewrote N file(s) to remove M reference(s)"
        // so the user isn't surprised by silent edits to sibling model files.
        const cascade = useWorkspaceStore.getState().lastDeleteCascade;
        if (cascade && cascade.filesUpdated && cascade.filesUpdated.length) {
          addToast({
            type: "info",
            message: `Removed ${cascade.entities.length} entity${cascade.entities.length === 1 ? "" : "s"} and rewrote ${cascade.filesUpdated.length} related file${cascade.filesUpdated.length === 1 ? "" : "s"}.`,
          });
        }
        if (cascade && cascade.failures && cascade.failures.length) {
          addToast({
            type: "warning",
            message: `Cascade partially failed (${cascade.failures.length} file${cascade.failures.length === 1 ? "" : "s"}). See console.`,
          });
          console.warn("[datalex] delete-cascade failures:", cascade.failures);
        }
      }
    } catch (err) {
      window.alert(`Action failed: ${err?.message || err}`);
    }
  }, [
    joinChild,
    createFolderAction,
    renameFileAction,
    renameFolderAction,
    moveFileAction,
    deleteFileAction,
    deleteFolderAction,
    addToast,
    openModal,
    openAiPanel,
    runReadinessReview,
  ]);

  const moveExplorerItem = React.useCallback(async (item, targetPath) => {
    if (!item?.path || !targetPath || item.path === targetPath) return;
    if (item.target === "folder") {
      await renameFolderAction(item.path, targetPath);
      addToast?.({ type: "success", message: `Moved folder to ${targetPath}.` });
    } else {
      await moveFileAction(item.path, targetPath);
      addToast?.({ type: "success", message: `Moved file to ${targetPath}.` });
    }
  }, [addToast, moveFileAction, renameFolderAction]);

  // Drag-and-drop: drop a file or folder onto a folder to move it there.
  const handleDropOnFolder = React.useCallback(async (sourcePath, folderPath, sourceKind = "file") => {
    if (!explorerReady || !sourcePath) return;
    const name = basenameFromPath(sourcePath);
    const destPath = joinChild(folderPath, name);
    if (destPath === sourcePath) return;
    if (sourceKind === "folder" && (folderPath === sourcePath || folderPath.startsWith(`${sourcePath}/`))) return;
    try {
      await moveExplorerItem({ target: sourceKind, path: sourcePath }, destPath);
    } catch (err) {
      window.alert(`Move failed: ${err?.message || err}`);
    }
  }, [explorerReady, joinChild, moveExplorerItem]);

  const filteredTables = tables.filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase()));

  const byKind = {
    TABLES:    filteredTables.filter((t) => t.kind !== "ENUM"),
    VIEWS:     [],
    ENUMS:     filteredTables.filter((t) => t.kind === "ENUM"),
    FUNCTIONS: [],
    SEQUENCES: [],
    TRIGGERS:  [],
  };

  const section = (key, label, items, renderItem) => (
    <div key={key} className={`tree-section ${collapsed[key] ? "collapsed" : ""}`}>
      <div className="tree-section-header" onClick={() => toggle(key)}>
        <svg className="tree-caret" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor" /></svg>
        <span>{label}</span>
        <span className="count">({items.length})</span>
        <button className="add" onClick={(e) => { e.stopPropagation(); onAddEntity && onAddEntity(key); }}><I.Plus /></button>
      </div>
      <div className="tree-items">{items.map(renderItem)}</div>
    </div>
  );

  const schemaList = schemas.length ? schemas : [{ name: "public", count: tables.length }];

  return (
    <div className="left">
      <div className="left-tabs">
        {["OBJECTS", "EXPLORER"].map((t) => (
          <button key={t} className={`left-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className="icon-btn"
          title="Collapse explorer"
          aria-label="Collapse explorer"
          onClick={() => setLeftPanelOpen(false)}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {tab === "OBJECTS" && (
        <>
          <div className="left-search">
            <div className="search-field">
              <I.Search />
              <input placeholder="Filter objects…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <button className="icon-btn" title="Filter"><I.Filter /></button>
          </div>
          <div className="tree">
            {section("TABLES", "Tables", byKind.TABLES, (t, index) => (
              <div key={`${t.id || t.name || "table"}:${index}`}
                   className={`tree-item ${activeTable === t.id ? "active" : ""}`}
                   onClick={() => onSelectTable(t.id)}>
                <I.Table />
                <span>{t.name}</span>
                <span className="badge">{t.columns.length}</span>
              </div>
            ))}
            {byKind.VIEWS.length > 0 && section("VIEWS", "Views", byKind.VIEWS, (v, index) => (
              <div key={`${v.id || v.name || "view"}:${index}`} className="tree-item"><I.View /><span>{v.name}</span></div>
            ))}
            {byKind.ENUMS.length > 0 && section("ENUMS", "Enums", byKind.ENUMS, (e, index) => (
              <div key={`${e.id || e.name || "enum"}:${index}`}
                   className={`tree-item ${activeTable === e.id ? "active" : ""}`}
                   onClick={() => onSelectTable(e.id)}>
                <I.Enum /><span>{e.name}</span>
              </div>
            ))}
            {subjectAreas.length > 0 && (
              <div className="tree-section">
                <div className="tree-section-header">
                  <svg className="tree-caret" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor" /></svg>
                  <span>Subject Areas</span><span className="count">({subjectAreas.length})</span>
                </div>
                <div className="tree-items">
                  {subjectAreas.map((s, index) => (
                    <div key={`${s.id || s.label || "subject"}:${index}`} className="tree-item">
                      <span className="swatch" style={{ background: s.color || `var(--cat-${s.cat})` }} />
                      <span>{s.label}</span>
                      <I.Eye />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "EXPLORER" && (
        <div
          className="tree"
          style={{ padding: "14px 16px" }}
          onContextMenu={(e) => {
            // Right-click on empty space in the Explorer falls through to the
            // "root" menu. Nodes stopPropagation so they take precedence.
            if (!explorerReady) return;
            e.preventDefault();
            setCtxMenu({ x: e.clientX, y: e.clientY, target: "root", path: "" });
          }}
        >
          <div className="left-search" style={{ padding: 0, marginBottom: 12 }}>
            <div className="search-field">
              <I.Search />
              <input
                placeholder="Find YAML or model file…"
                value={explorerQuery}
                onChange={(e) => setExplorerQuery(e.target.value)}
              />
            </div>
            {explorerQuery ? (
              <button className="icon-btn" title="Clear search" onClick={() => setExplorerQuery("")}>
                <I.X />
              </button>
            ) : (
              <button className="icon-btn" title="Search workspace files">
                <I.Filter />
              </button>
            )}
          </div>

          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Workspace</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--border-default)", borderRadius: 6, marginBottom: 12 }}>
            <I.Db />
            <div style={{ flex: 1, minWidth: 0 }}>
              {projects.length > 1 && onSelectProject ? (
                <select
                  value={activeProjectId || ""}
                  onChange={(e) => onSelectProject(e.target.value)}
                  style={{
                    width: "100%",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    background: "transparent",
                    color: "var(--text-primary)",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  title="Switch project"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connectionLabel}</div>
              )}
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connectionDsn}</div>
            </div>
            <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-success)" }} />
          </div>

          <div data-tour="explorer-files" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Files</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {explorerReady && (
                <>
                  <button
                    className="icon-btn"
                    title="New modeling asset"
                    onClick={() => handleCtxAction("new-file", { target: "root", path: "" })}
                    style={{ padding: 2 }}
                  >
                    <I.Plus />
                  </button>
                  <button
                    className="icon-btn"
                    title="New folder"
                    onClick={() => handleCtxAction("new-folder", { target: "root", path: "" })}
                    style={{ padding: 2 }}
                  >
                    <I.Folder />
                  </button>
                  <button
                    data-tour="new-diagram"
                    className="icon-btn"
                    title="New diagram"
                    onClick={() => openModal("newFile", { artifact: "diagram" })}
                    style={{ padding: 2 }}
                  >
                    <I.Layers />
                  </button>
                  <button
                    className="icon-btn"
                    title="Rerun dbt readiness review"
                    onClick={() => handleCtxAction("dbt-readiness", { target: "root", path: "" })}
                    disabled={dbtReadinessLoading}
                    style={{ padding: 2 }}
                  >
                    <I.Check />
                  </button>
                </>
              )}
              <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>{(projectFiles || []).length}</div>
            </div>
          </div>

          {(!projectFiles || projectFiles.length === 0) ? (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "8px 2px", lineHeight: 1.5 }}>
              No files yet. Open a project or import a dbt repo.
            </div>
          ) : (explorerQuery && filteredFileTree.length === 0) ? (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", padding: "8px 2px", lineHeight: 1.5 }}>
              No matching files for “{explorerQuery}”.
            </div>
          ) : (
            <TreeRender
              nodes={filteredFileTree}
              folded={folded}
              toggleFolder={toggleFolder}
              activeFullPath={activeFullPath}
              onOpenFile={openFile}
              I={I}
              depth={0}
              onContextMenu={explorerReady ? openCtxMenu : null}
              onDropOnFolder={explorerReady ? handleDropOnFolder : null}
              onMoveItem={explorerReady ? (target, path) => setMoveState({ target, path }) : null}
              dragStateRef={dragStateRef}
              readinessByPath={readinessByPath}
            />
          )}

          <ExplorerContextMenu
            menu={ctxMenu}
            onClose={closeCtxMenu}
            onAction={handleCtxAction}
          />
          <MoveExplorerItemDialog
            moveState={moveState}
            folders={folderOptions}
            onClose={() => setMoveState(null)}
            onMove={moveExplorerItem}
          />
        </div>
      )}

    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Recursive file-tree renderer for the EXPLORER tab.
 *
 * A `TreeNode` is either a folder `{kind:"folder", name, path, children}` or
 * a file `{kind:"file", name, path, file}`. Indentation is computed from
 * `depth` so nested folders visually nest without an extra per-row style.
 * Folder rows are fold/unfold triggers; file rows open the file in the
 * workspace (same code path as the legacy flat list). Clicking the active
 * file re-opens it — harmless but consistent with "click a row to focus".
 * ------------------------------------------------------------------ */
function TreeRender({
  nodes,
  folded,
  toggleFolder,
  activeFullPath,
  onOpenFile,
  I,
  depth,
  onContextMenu = null,
  onDropOnFolder = null,
  onMoveItem = null,
  dragStateRef = null,
  readinessByPath = {},
}) {
  if (!nodes || nodes.length === 0) return null;
  // `dragOver` toggles a visual highlight on folder rows while a file is
  // dragged over them. Keyed by folder path to keep the state local.
  const [dragOverPath, setDragOverPath] = React.useState("");
  return (
    <>
      {nodes.map((n) => {
        const indent = 8 + depth * 12;
        if (n.kind === "folder") {
          const isFolded = !!folded[n.path];
          const count = countFiles(n);
          const isDragOver = dragOverPath === n.path;
          const meta = artifactMeta(n.path, n.name, "folder");
          return (
            <div key={`f:${n.path}`}>
              <div
                className={`tree-item tree-artifact tree-artifact-${meta.tone}`}
                onClick={() => {
                  const dragState = dragStateRef?.current;
                  if (
                    dragState &&
                    dragState.path === n.path &&
                    Date.now() - dragState.at < 500
                  ) {
                    dragState.path = "";
                    return;
                  }
                  toggleFolder(n.path);
                }}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, "folder", n.path) : undefined}
                draggable={!!onDropOnFolder}
                title={n.path}
                style={{
                  paddingLeft: indent,
                  cursor: onDropOnFolder ? "grab" : "pointer",
                  background: isDragOver ? "var(--accent-dim, var(--bg-3))" : undefined,
                  outline: isDragOver ? "1px solid var(--accent, var(--border-default))" : undefined,
                  transition: "background 80ms var(--ease)",
                }}
                onDragStart={onDropOnFolder ? (e) => {
                  if (dragStateRef?.current) {
                    dragStateRef.current.path = n.path;
                    dragStateRef.current.at = Date.now();
                  }
                  e.dataTransfer.setData("application/x-datalex-folder-path", n.path);
                  e.dataTransfer.effectAllowed = "move";
                } : undefined}
                onDragOver={onDropOnFolder ? (e) => {
                  e.preventDefault();
                  const sourceFolderPath = e.dataTransfer.getData("application/x-datalex-folder-path");
                  if (sourceFolderPath && (n.path === sourceFolderPath || n.path.startsWith(`${sourceFolderPath}/`))) {
                    e.dataTransfer.dropEffect = "none";
                    return;
                  }
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverPath !== n.path) setDragOverPath(n.path);
                } : undefined}
                onDragLeave={onDropOnFolder ? () => {
                  if (dragOverPath === n.path) setDragOverPath("");
                } : undefined}
                onDrop={onDropOnFolder ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverPath("");
                  const sourceFolderPath = e.dataTransfer.getData("application/x-datalex-folder-path");
                  const sourceFilePath = e.dataTransfer.getData("application/x-datalex-file-path");
                  if (sourceFolderPath) onDropOnFolder(sourceFolderPath, n.path, "folder");
                  else if (sourceFilePath) onDropOnFolder(sourceFilePath, n.path, "file");
                } : undefined}
                onDragEnd={onDropOnFolder ? () => {
                  if (!dragStateRef?.current) return;
                  window.setTimeout(() => {
                    dragStateRef.current.path = "";
                    dragStateRef.current.at = 0;
                  }, 0);
                } : undefined}
              >
                <svg
                  className="tree-caret"
                  viewBox="0 0 10 10"
                  style={{
                    transform: isFolded ? "rotate(0deg)" : "rotate(90deg)",
                    transition: "transform 120ms var(--ease)",
                    flex: "0 0 10px",
                  }}
                >
                  <path d="M3 2l4 3-4 3" fill="currentColor" />
                </svg>
                <span className="tree-artifact-icon"><ArtifactIcon I={I} meta={meta} /></span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                {onMoveItem && (
                  <button
                    type="button"
                    className="tree-inline-action"
                    title={`Move folder ${n.path}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onMoveItem("folder", n.path);
                    }}
                  >
                    <I.Arrow />
                  </button>
                )}
                <span className="badge">{count}</span>
              </div>
              {!isFolded && (
                <TreeRender
                  nodes={n.children}
                  folded={folded}
                  toggleFolder={toggleFolder}
                  activeFullPath={activeFullPath}
                  onOpenFile={onOpenFile}
                  I={I}
                  depth={depth + 1}
                  onContextMenu={onContextMenu}
                  onDropOnFolder={onDropOnFolder}
                  onMoveItem={onMoveItem}
                  dragStateRef={dragStateRef}
                  readinessByPath={readinessByPath}
                />
              )}
            </div>
          );
        }

        const fd = n.file || {};
        const fullPath = fd.fullPath || fd.path || n.path;
        const isActive = activeFullPath && fullPath === activeFullPath;
        const meta = artifactMeta(n.path, n.name, "file");
        const readiness = readinessByPath[n.path] || readinessByPath[fullPath];
        const openThisFile = () => {
          if (onOpenFile && fd) onOpenFile(fd);
        };
        return (
          <div
            key={`l:${n.path}`}
            className={`tree-item tree-artifact tree-artifact-${meta.tone} ${isActive ? "active" : ""}`}
            onClick={() => {
              openThisFile();
            }}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, "file", n.path) : undefined}
            draggable={!!onDropOnFolder}
            onDragStart={onDropOnFolder ? (e) => {
              if (dragStateRef?.current) {
                dragStateRef.current.path = n.path;
                dragStateRef.current.at = Date.now();
              }
              // Carry the source file's subpath through the drag payload.
              // The drop target is a folder row that knows how to move it.
              e.dataTransfer.setData("application/x-datalex-file-path", n.path);
              // YAML sources also carry a second payload so the canvas drop
              // zone can reject non-YAML drags cleanly. We don't peek at the
              // content here — the canvas adapter figures out dbt-schema vs
              // datalex-model shape at render time.
              if (/\.ya?ml$/i.test(n.name || "")) {
                const fullPath = (fd.fullPath || fd.path || n.path || "").replace(/^[/\\]+/, "");
                e.dataTransfer.setData(
                  "application/x-datalex-yaml-source",
                  JSON.stringify({ path: fullPath })
                );
                e.dataTransfer.setData("text/plain", fullPath);
              }
              e.dataTransfer.effectAllowed = "copyMove";
            } : undefined}
            onDragEnd={onDropOnFolder ? () => {
              if (!dragStateRef?.current) return;
              window.setTimeout(() => {
                dragStateRef.current.path = "";
                dragStateRef.current.at = 0;
              }, 0);
            } : undefined}
            title={fullPath || n.path}
            style={{ paddingLeft: indent + 10, cursor: onDropOnFolder ? "grab" : undefined }}
          >
            <span className="tree-artifact-icon"><ArtifactIcon I={I} meta={meta} /></span>
            <button
              type="button"
              className="tree-file-open"
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openThisFile();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openThisFile();
              }}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
                border: 0,
                padding: 0,
                background: "transparent",
                color: "inherit",
                font: "inherit",
                textAlign: "left",
              }}
            >
              {n.name}
            </button>
            <ReadinessBadge review={readiness} />
            {onMoveItem && (
              <button
                type="button"
                className="tree-inline-action"
                title={`Move file ${n.path}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onMoveItem("file", n.path);
                }}
              >
                <I.Arrow />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
