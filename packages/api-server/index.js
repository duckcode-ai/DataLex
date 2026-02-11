import express from "express";
import cors from "cors";
import { readdir, readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, relative, extname, basename } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "fs";
import { execFileSync } from "child_process";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[datalex] ${req.method} ${req.url}`);
  next();
});

// Project root defaults to the monorepo root (two levels up from packages/api-server)
const REPO_ROOT = process.env.REPO_ROOT || join(process.cwd(), "../..");
const PROJECTS_FILE = join(REPO_ROOT, ".dm-projects.json");

async function loadProjects() {
  try {
    if (existsSync(PROJECTS_FILE)) {
      const raw = await readFile(PROJECTS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (_err) {
    // ignore
  }
  // Default: include model-examples as a starter project
  const defaultProjects = [
    {
      id: "default",
      name: "model-examples",
      path: join(REPO_ROOT, "model-examples"),
    },
  ];
  return defaultProjects;
}

async function saveProjects(projects) {
  await writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

// List all registered projects
app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await loadProjects();
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a project folder
app.post("/api/projects", async (req, res) => {
  try {
    const { name, path: folderPath } = req.body;
    if (!name || !folderPath) {
      return res.status(400).json({ error: "name and path are required" });
    }
    if (!existsSync(folderPath)) {
      return res.status(400).json({ error: `Path does not exist: ${folderPath}` });
    }
    const projects = await loadProjects();
    const id = `proj_${Date.now()}`;
    projects.push({ id, name, path: folderPath });
    await saveProjects(projects);
    res.json({ project: { id, name, path: folderPath } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a project
app.delete("/api/projects/:id", async (req, res) => {
  try {
    let projects = await loadProjects();
    projects = projects.filter((p) => p.id !== req.params.id);
    await saveProjects(projects);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List files in a project folder (recursive, *.model.yaml and *.yml)
app.get("/api/projects/:id/files", async (req, res) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const files = await walkYamlFiles(project.path);
    res.json({ projectId: project.id, projectPath: project.path, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function walkYamlFiles(dir, base = dir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (_err) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const sub = await walkYamlFiles(fullPath, base);
      results.push(...sub);
    } else if (
      entry.name.endsWith(".model.yaml") ||
      entry.name.endsWith(".model.yml") ||
      entry.name.endsWith(".policy.yaml")
    ) {
      const relPath = relative(base, fullPath);
      const stats = await stat(fullPath);
      results.push({
        name: entry.name,
        path: relPath,
        fullPath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }
  }
  return results;
}

// Read a file's content
app.get("/api/files", async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: "path query param required" });
    }
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = await readFile(filePath, "utf-8");
    const stats = await stat(filePath);
    res.json({
      path: filePath,
      name: basename(filePath),
      content,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write/update a file
app.put("/api/files", async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || typeof content !== "string") {
      return res.status(400).json({ error: "path and content are required" });
    }
    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    if (dir && !existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, content, "utf-8");
    const stats = await stat(filePath);
    res.json({
      path: filePath,
      name: basename(filePath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new file in a project
app.post("/api/projects/:id/files", async (req, res) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { name, content = "" } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const filePath = join(project.path, name);
    if (existsSync(filePath)) {
      return res.status(409).json({ error: "File already exists" });
    }

    await writeFile(filePath, content, "utf-8");
    const stats = await stat(filePath);
    res.json({
      path: relative(project.path, filePath),
      fullPath: filePath,
      name,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve cross-model imports for a project
app.get("/api/projects/:id/model-graph", async (req, res) => {
  try {
    const projects = await loadProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Find all model files and parse their imports
    const files = await walkYamlFiles(project.path);
    const modelFiles = files.filter(
      (f) => f.name.endsWith(".model.yaml") || f.name.endsWith(".model.yml")
    );

    const models = [];
    const crossModelRels = [];

    // Parse each model file for its name, entities, and imports
    for (const file of modelFiles) {
      try {
        const content = await readFile(file.fullPath, "utf-8");
        // Simple YAML-like parsing for model metadata
        const nameMatch = content.match(/^\s*name:\s*(.+)$/m);
        const modelName = nameMatch ? nameMatch[1].trim() : file.name;

        // Extract entity names
        const entityNames = [];
        const entityRegex = /^\s*-\s*name:\s*([A-Z][A-Za-z0-9]*)\s*$/gm;
        let match;
        while ((match = entityRegex.exec(content)) !== null) {
          entityNames.push(match[1]);
        }

        // Extract imports
        const imports = [];
        const importSection = content.match(/imports:\s*\n((?:\s+-[^\n]+\n?)*)/);
        if (importSection) {
          const importModelRegex = /model:\s*(\S+)/g;
          let im;
          while ((im = importModelRegex.exec(importSection[1])) !== null) {
            imports.push(im[1]);
          }
        }

        models.push({
          name: modelName,
          file: file.fullPath,
          path: file.path,
          entities: entityNames,
          entity_count: entityNames.length,
          imports,
        });
      } catch (_err) {
        // Skip unparseable files
      }
    }

    // Build entity-to-model map
    const entityToModel = {};
    for (const m of models) {
      for (const e of m.entities) {
        entityToModel[e] = m.name;
      }
    }

    // Find cross-model relationships by scanning relationship sections
    for (const file of modelFiles) {
      try {
        const content = await readFile(file.fullPath, "utf-8");
        const nameMatch = content.match(/^\s*name:\s*(.+)$/m);
        const modelName = nameMatch ? nameMatch[1].trim() : file.name;

        // Find relationship from/to references
        const relRegex = /from:\s*([A-Z][A-Za-z0-9]*)\.(\w+)\s*\n\s*to:\s*([A-Z][A-Za-z0-9]*)\.(\w+)/g;
        let rm;
        while ((rm = relRegex.exec(content)) !== null) {
          const fromEntity = rm[1];
          const toEntity = rm[3];
          const fromModel = entityToModel[fromEntity] || modelName;
          const toModel = entityToModel[toEntity] || modelName;
          if (fromModel !== toModel) {
            crossModelRels.push({
              from_model: fromModel,
              to_model: toModel,
              from_entity: fromEntity,
              to_entity: toEntity,
            });
          }
        }
      } catch (_err) {
        // skip
      }
    }

    res.json({
      projectId: project.id,
      model_count: models.length,
      total_entities: models.reduce((sum, m) => sum + m.entity_count, 0),
      models,
      cross_model_relationships: crossModelRels,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import schema files (SQL, DBML, Spark Schema)
app.post("/api/import", express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const { format, content, filename, modelName } = req.body;
    if (!format || !content) {
      return res.status(400).json({ error: "Missing format or content" });
    }

    const formatMap = {
      sql: "sql",
      dbml: "dbml",
      "spark-schema": "spark-schema",
    };
    const importFormat = formatMap[format];
    if (!importFormat) {
      return res.status(400).json({ error: `Unsupported format: ${format}. Supported: sql, dbml, spark-schema` });
    }

    // Write content to temp file
    const tmpDir = join(REPO_ROOT, ".tmp-import");
    mkdirSync(tmpDir, { recursive: true });
    const ext = { sql: ".sql", dbml: ".dbml", "spark-schema": ".json" }[format];
    const tmpFile = join(tmpDir, `import_${Date.now()}${ext}`);
    writeFileSync(tmpFile, content, "utf-8");

    const args = [
      join(REPO_ROOT, "dm"),
      "import",
      importFormat,
      tmpFile,
      "--model-name",
      modelName || "imported_model",
    ];

    let yamlOutput;
    try {
      yamlOutput = execFileSync("python3", args, {
        encoding: "utf-8",
        timeout: 30000,
      });
    } finally {
      try { unlinkSync(tmpFile); } catch (_) {}
      try { rmdirSync(tmpDir); } catch (_) {}
    }
    let model;
    try {
      // The output may contain issue lines before the YAML
      const yamlStart = yamlOutput.indexOf("model:");
      const yamlText = yamlStart >= 0 ? yamlOutput.substring(yamlStart) : yamlOutput;
      model = yaml.load(yamlText);
    } catch (_) {
      model = null;
    }

    const entities = model?.entities || [];
    const relationships = model?.relationships || [];
    const indexes = model?.indexes || [];
    const fieldCount = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

    res.json({
      success: true,
      entityCount: entities.length,
      fieldCount,
      relationshipCount: relationships.length,
      indexCount: indexes.length,
      yaml: yamlOutput.indexOf("model:") >= 0 ? yamlOutput.substring(yamlOutput.indexOf("model:")) : yamlOutput,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: build connection args array from request params
function buildConnArgs(params) {
  const args = [];
  if (params.host) { args.push("--host", params.host); }
  if (params.port) { args.push("--port", String(params.port)); }
  if (params.database) { args.push("--database", params.database); }
  if (params.db_schema) { args.push("--db-schema", params.db_schema); }
  if (params.user) { args.push("--user", params.user); }
  if (params.password) { args.push("--password", params.password); }
  if (params.warehouse) { args.push("--warehouse", params.warehouse); }
  if (params.project) { args.push("--project", params.project); }
  if (params.dataset) { args.push("--dataset", params.dataset); }
  if (params.catalog) { args.push("--catalog", params.catalog); }
  if (params.token) { args.push("--token", params.token); }
  return args;
}

// List available database connectors
app.get("/api/connectors", (req, res) => {
  try {
    const output = execFileSync("python3", [
      join(REPO_ROOT, "dm"), "connectors", "--output-json",
    ], { encoding: "utf-8", timeout: 10000 });
    const connectors = JSON.parse(output);
    res.json(connectors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test database connection
app.post("/api/connectors/test", express.json(), async (req, res) => {
  try {
    const { connector, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    const args = [join(REPO_ROOT, "dm"), "pull", connector, "--test", ...buildConnArgs(params)];

    try {
      const output = execFileSync("python3", args, { encoding: "utf-8", timeout: 30000 });
      const ok = output.startsWith("OK");
      res.json({ ok, message: output.trim() });
    } catch (execErr) {
      const stderr = execErr.stderr || execErr.message;
      res.json({ ok: false, message: stderr.trim() });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List schemas/datasets in a database
app.post("/api/connectors/schemas", express.json(), async (req, res) => {
  try {
    const { connector, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    const args = [join(REPO_ROOT, "dm"), "schemas", connector, "--output-json", ...buildConnArgs(params)];
    const output = execFileSync("python3", args, { encoding: "utf-8", timeout: 30000 });
    const schemas = JSON.parse(output);
    res.json(schemas);
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: stderr });
  }
});

// List tables in a schema
app.post("/api/connectors/tables", express.json(), async (req, res) => {
  try {
    const { connector, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    const args = [join(REPO_ROOT, "dm"), "tables", connector, "--output-json", ...buildConnArgs(params)];
    const output = execFileSync("python3", args, { encoding: "utf-8", timeout: 30000 });
    const tables = JSON.parse(output);
    res.json(tables);
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: stderr });
  }
});

// Pull schema from database
app.post("/api/connectors/pull", express.json(), async (req, res) => {
  try {
    const { connector, model_name, tables, ...params } = req.body;
    if (!connector) return res.status(400).json({ error: "Missing connector type" });

    const args = [join(REPO_ROOT, "dm"), "pull", connector, ...buildConnArgs(params)];
    if (model_name) { args.push("--model-name", model_name); }
    if (tables) {
      const tableList = typeof tables === "string" ? tables.split(",").map(t => t.trim()).filter(Boolean) : tables;
      if (tableList.length) { args.push("--tables", ...tableList); }
    }

    const output = execFileSync("python3", args, { encoding: "utf-8", timeout: 60000 });

    // Parse YAML output
    const yamlStart = output.indexOf("model:");
    const yamlText = yamlStart >= 0 ? output.substring(yamlStart) : output;
    let model;
    try { model = yaml.load(yamlText); } catch (_) { model = null; }

    const entities = model?.entities || [];
    const relationships = model?.relationships || [];
    const indexes = model?.indexes || [];
    const fieldCount = entities.reduce((sum, e) => sum + (e.fields || []).length, 0);

    res.json({
      success: true,
      entityCount: entities.length,
      fieldCount,
      relationshipCount: relationships.length,
      indexCount: indexes.length,
      yaml: yamlText,
    });
  } catch (err) {
    const stderr = err.stderr || err.message;
    res.status(500).json({ error: stderr });
  }
});

app.listen(PORT, () => {
  console.log(`[datalex] Local file server running on http://localhost:${PORT}`);
  console.log(`[datalex] Repo root: ${REPO_ROOT}`);
});
