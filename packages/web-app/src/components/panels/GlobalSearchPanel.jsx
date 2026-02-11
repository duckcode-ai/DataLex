import React, { useState, useMemo, useCallback } from "react";
import { Search, X, Database, Columns3, Tag, FileText, BookOpen, ChevronRight } from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

const CATEGORY_ICONS = {
  entity: Database,
  field: Columns3,
  tag: Tag,
  description: FileText,
  glossary: BookOpen,
};

const CATEGORY_COLORS = {
  entity: "bg-blue-50 text-blue-700 border-blue-200",
  field: "bg-emerald-50 text-emerald-700 border-emerald-200",
  tag: "bg-purple-50 text-purple-700 border-purple-200",
  description: "bg-amber-50 text-amber-700 border-amber-200",
  glossary: "bg-cyan-50 text-cyan-700 border-cyan-200",
};

function buildSearchIndex(model) {
  if (!model) return [];
  const results = [];

  for (const entity of model.entities || []) {
    // Entity name
    results.push({
      category: "entity",
      text: entity.name,
      entityName: entity.name,
      detail: `${entity.type || "table"} — ${(entity.fields || []).length} fields`,
      subDetail: entity.subject_area || "",
    });

    // Entity description
    if (entity.description) {
      results.push({
        category: "description",
        text: entity.description,
        entityName: entity.name,
        detail: `Description of ${entity.name}`,
      });
    }

    // Tags
    for (const tag of entity.tags || []) {
      results.push({
        category: "tag",
        text: String(tag),
        entityName: entity.name,
        detail: `Tag on ${entity.name}`,
      });
    }

    // Fields
    for (const field of entity.fields || []) {
      results.push({
        category: "field",
        text: field.name,
        entityName: entity.name,
        detail: `${field.type || "?"} in ${entity.name}`,
        subDetail: [
          field.primary_key && "PK",
          field.unique && "UQ",
          field.foreign_key && "FK",
          field.sensitivity,
        ].filter(Boolean).join(" · "),
      });

      if (field.description) {
        results.push({
          category: "description",
          text: field.description,
          entityName: entity.name,
          detail: `Description of ${entity.name}.${field.name}`,
        });
      }
    }
  }

  // Glossary
  for (const term of model.glossary || []) {
    results.push({
      category: "glossary",
      text: term.term || term.name || "",
      entityName: null,
      detail: term.definition || "",
    });
  }

  return results;
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function GlobalSearchPanel() {
  const { model, selectEntity } = useDiagramStore();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const index = useMemo(() => buildSearchIndex(model), [model]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return index.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      return (
        item.text.toLowerCase().includes(q) ||
        (item.detail || "").toLowerCase().includes(q) ||
        (item.subDetail || "").toLowerCase().includes(q)
      );
    });
  }, [query, index, categoryFilter]);

  const categoryCounts = useMemo(() => {
    if (!query.trim()) return {};
    const q = query.toLowerCase();
    const counts = {};
    for (const item of index) {
      if (
        item.text.toLowerCase().includes(q) ||
        (item.detail || "").toLowerCase().includes(q) ||
        (item.subDetail || "").toLowerCase().includes(q)
      ) {
        counts[item.category] = (counts[item.category] || 0) + 1;
      }
    }
    return counts;
  }, [query, index]);

  const handleSelect = useCallback((item) => {
    if (item.entityName) {
      selectEntity(item.entityName);
    }
  }, [selectEntity]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search input */}
      <div className="px-3 py-2 border-b border-border-primary flex items-center gap-2">
        <Search size={14} className="text-text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entities, fields, tags, descriptions, glossary…"
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          autoFocus
        />
        {query && (
          <button onClick={() => setQuery("")} className="p-0.5 rounded hover:bg-bg-hover text-text-muted">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Category filter pills */}
      {query.trim() && (
        <div className="px-3 py-1.5 border-b border-border-primary flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
              categoryFilter === "all"
                ? "bg-slate-700 text-white border-slate-700"
                : "bg-bg-tertiary text-text-secondary border-border-primary hover:bg-bg-hover"
            }`}
          >
            All ({Object.values(categoryCounts).reduce((a, b) => a + b, 0)})
          </button>
          {Object.entries(categoryCounts).map(([cat, count]) => {
            const Icon = CATEGORY_ICONS[cat] || FileText;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                  categoryFilter === cat
                    ? CATEGORY_COLORS[cat] || "bg-slate-100 text-slate-700 border-slate-300"
                    : "bg-bg-tertiary text-text-secondary border-border-primary hover:bg-bg-hover"
                }`}
              >
                <Icon size={9} />
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!query.trim() ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            <div className="text-center">
              <Search size={24} className="mx-auto mb-2 opacity-30" />
              <p>Type to search across your model</p>
              <p className="text-[10px] mt-1">Entities, fields, tags, descriptions, glossary terms</p>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            No results for "{query}"
          </div>
        ) : (
          <div className="divide-y divide-border-primary">
            {results.slice(0, 100).map((item, i) => {
              const Icon = CATEGORY_ICONS[item.category] || FileText;
              return (
                <button
                  key={i}
                  onClick={() => handleSelect(item)}
                  className="w-full text-left px-3 py-2 hover:bg-bg-hover transition-colors flex items-start gap-2"
                >
                  <span className={`mt-0.5 p-1 rounded ${CATEGORY_COLORS[item.category] || ""}`}>
                    <Icon size={10} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text-primary truncate">
                      {highlightMatch(item.text, query)}
                    </div>
                    <div className="text-[10px] text-text-muted truncate">
                      {highlightMatch(item.detail || "", query)}
                    </div>
                    {item.subDetail && (
                      <div className="text-[10px] text-text-muted truncate">{item.subDetail}</div>
                    )}
                  </div>
                  {item.entityName && (
                    <ChevronRight size={10} className="text-text-muted mt-1 shrink-0" />
                  )}
                </button>
              );
            })}
            {results.length > 100 && (
              <div className="px-3 py-2 text-[10px] text-text-muted text-center">
                Showing 100 of {results.length} results. Refine your search.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
