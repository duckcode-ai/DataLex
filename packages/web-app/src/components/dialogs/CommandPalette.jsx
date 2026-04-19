import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronRight } from "lucide-react";
import useUiStore from "../../stores/uiStore";
import { buildCommands, fuzzyMatch } from "../../lib/commandRegistry";

const SECTION_ORDER = [
  "File",
  "Create",
  "Diagram",
  "Go to",
  "Project",
  "View",
  "Preferences",
  "Settings",
  "Git",
  "Navigate",
];

export default function CommandPalette() {
  const { closeModal } = useUiStore();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Rebuild commands every time the palette opens so entity jumps / toggle
  // labels reflect current state.
  const commands = useMemo(() => buildCommands(), []);

  const results = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((c) => {
        const m = fuzzyMatch(query, c.title, c.keywords);
        return m ? { cmd: c, score: m.score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.cmd);
  }, [commands, query]);

  // Group by section while preserving rank order within each section.
  const sections = useMemo(() => {
    const map = new Map();
    for (const cmd of results) {
      const key = cmd.section || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(cmd);
    }
    const ordered = [];
    for (const key of SECTION_ORDER) {
      if (map.has(key)) {
        ordered.push([key, map.get(key)]);
        map.delete(key);
      }
    }
    for (const [key, items] of map.entries()) ordered.push([key, items]);
    return ordered;
  }, [results]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Keep active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const run = (cmd) => {
    try {
      cmd.run?.();
    } finally {
      closeModal();
    }
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[activeIdx];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      closeModal();
    }
  };

  let runningIdx = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/50 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        className="w-[640px] max-w-[94vw] rounded-xl border border-border-primary bg-bg-surface shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border-primary">
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command or search entities…"
            className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted"
          />
          <kbd className="text-[10px] text-text-muted font-mono">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-text-muted">
              No commands match "{query}"
            </div>
          )}
          {sections.map(([section, items]) => (
            <div key={section}>
              <div className="px-3 pt-2 pb-1 t-overline text-text-muted">{section}</div>
              {items.map((cmd) => {
                runningIdx++;
                const i = runningIdx;
                const Icon = cmd.icon;
                const isActive = i === activeIdx;
                return (
                  <button
                    key={cmd.id}
                    data-idx={i}
                    onClick={() => run(cmd)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-bg-active text-text-accent"
                        : "text-text-secondary hover:bg-bg-hover"
                    }`}
                  >
                    {Icon ? (
                      <Icon size={13} strokeWidth={1.75} className="shrink-0" />
                    ) : (
                      <ChevronRight size={13} className="shrink-0 opacity-50" />
                    )}
                    <span className="flex-1 truncate">{cmd.title}</span>
                    {cmd.shortcut && (
                      <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-subtle text-text-muted shrink-0">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-3 h-7 border-t border-border-primary bg-bg-secondary text-[10px] text-text-muted">
          <span>{results.length} {results.length === 1 ? "result" : "results"}</span>
          <span className="font-mono">↑↓ navigate · ⏎ run</span>
        </div>
      </div>
    </div>
  );
}
