import React, { useState, useMemo } from "react";
import { Search, X, ArrowUpDown, Table2, Eye, ArrowRightLeft, Database, ChevronRight } from "lucide-react";
import useDiagramStore from "../../stores/diagramStore";

const TYPE_BADGE = {
  table: "bg-blue-100 text-blue-700",
  view: "bg-purple-100 text-purple-700",
  materialized_view: "bg-indigo-100 text-indigo-700",
  external_table: "bg-teal-100 text-teal-700",
  snapshot: "bg-amber-100 text-amber-700",
};

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "fields", label: "Fields" },
  { value: "rels", label: "Relationships" },
];

export default function EntityListPanel() {
  const {
    model,
    edges,
    selectedEntityId,
    selectEntity,
    setCenterEntityId,
    getSchemaOptions,
  } = useDiagramStore();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [schemaFilter, setSchemaFilter] = useState("all");

  const entities = model?.entities || [];
  const schemaOptions = getSchemaOptions();

  // Compute relationship counts per entity
  const relCounts = useMemo(() => {
    const counts = {};
    (edges || []).forEach((e) => {
      counts[e.source] = (counts[e.source] || 0) + 1;
      counts[e.target] = (counts[e.target] || 0) + 1;
    });
    return counts;
  }, [edges]);

  // Filter and sort
  const filteredEntities = useMemo(() => {
    let list = entities.map((e) => ({
      ...e,
      fieldCount: (e.fields || []).length,
      relCount: relCounts[e.name] || 0,
      schemaKey: e.subject_area || e.schema || "(default)",
    }));

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q) ||
        (e.fields || []).some((f) => f.name.toLowerCase().includes(q))
      );
    }

    if (schemaFilter !== "all") {
      list = list.filter((e) => e.schemaKey === schemaFilter);
    }

    if (sortBy === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "fields") list.sort((a, b) => b.fieldCount - a.fieldCount);
    else if (sortBy === "rels") list.sort((a, b) => b.relCount - a.relCount);

    return list;
  }, [entities, search, schemaFilter, sortBy, relCounts]);

  const handleClick = (entityName) => {
    selectEntity(entityName);
    setCenterEntityId(entityName);
  };

  if (entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
        <Database size={32} className="text-slate-300 mb-3" />
        <p className="text-sm text-slate-500 font-medium">No entities loaded</p>
        <p className="text-xs text-slate-400 mt-1">Open a model file to see entities here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + controls */}
      <div className="px-3 py-2 border-b border-slate-200 space-y-2">
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-blue-100 transition-all">
          <Search size={12} className="text-slate-400 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities, fields..."
            className="bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none w-full"
          />
          {search && (
            <button onClick={() => setSearch("")} className="p-0.5 rounded hover:bg-slate-200 text-slate-400">
              <X size={10} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <ArrowUpDown size={10} className="text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-slate-600 outline-none cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {schemaOptions.length > 1 && (
            <select
              value={schemaFilter}
              onChange={(e) => setSchemaFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10px] text-slate-600 outline-none cursor-pointer flex-1 min-w-0"
            >
              <option value="all">All schemas ({entities.length})</option>
              {schemaOptions.map((s) => (
                <option key={s.name} value={s.name}>{s.name} ({s.entityCount})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Count badge */}
      <div className="px-3 py-1 bg-slate-50 border-b border-slate-100 text-[10px] text-slate-400 font-medium">
        {filteredEntities.length} of {entities.length} entities
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto">
        {filteredEntities.map((entity) => {
          const isSelected = selectedEntityId === entity.name;
          const type = entity.type || "table";
          const badgeCls = TYPE_BADGE[type] || TYPE_BADGE.table;

          return (
            <div
              key={entity.name}
              onClick={() => handleClick(entity.name)}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-slate-50 transition-colors ${
                isSelected
                  ? "bg-blue-50 border-l-2 border-l-blue-500"
                  : "hover:bg-slate-50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-semibold truncate ${isSelected ? "text-blue-700" : "text-slate-800"}`}>
                    {entity.name}
                  </span>
                  <span className={`px-1 py-0 rounded text-[9px] font-bold uppercase ${badgeCls}`}>
                    {type.replace("_", " ")}
                  </span>
                </div>
                {entity.schemaKey !== "(default)" && (
                  <span className="text-[9px] text-slate-400 truncate block mt-0.5">{entity.schemaKey}</span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="flex items-center gap-0.5 text-[10px] text-slate-400" title="Fields">
                  <Table2 size={9} />
                  {entity.fieldCount}
                </span>
                {entity.relCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-slate-400" title="Relationships">
                    <ArrowRightLeft size={9} />
                    {entity.relCount}
                  </span>
                )}
              </div>

              <ChevronRight size={12} className={`shrink-0 ${isSelected ? "text-blue-400" : "text-slate-300"}`} />
            </div>
          );
        })}

        {filteredEntities.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-slate-400">No entities match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
