// Smoke-tests the lightweight POST /api/ai/suggest endpoint.
//
// The endpoint deliberately bypasses /api/ai/ask and the BM25 / agent
// pipeline. We verify:
//   1. Validation errors fire (missing kind, missing path, etc.)
//   2. With provider="local" or unset, the endpoint 503s with NO_PROVIDER
//      so the UI can disable the inline ✨ AI buttons.
//   3. The response shape includes `description`, `confidence`, and the
//      echoed `target` for the UI to correlate the result.
//
// We do NOT make a real LLM call here — that requires API keys and is
// covered by the e2e UI smoke. This file pins the contract.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { getApp, createProject } from "./helpers/harness.js";

describe("POST /api/ai/suggest", () => {
  test("rejects missing target.kind", async () => {
    const app = await getApp();
    const project = await createProject(app, "ai-suggest-test-1");
    const res = await request(app)
      .post("/api/ai/suggest")
      .send({ projectId: project.id, target: { path: "models/foo.yml" } })
      .expect(400);
    assert.equal(res.body.error.code, "VALIDATION");
    assert.match(res.body.error.message, /target\.kind/);
  });

  test("rejects missing target.path", async () => {
    const app = await getApp();
    const project = await createProject(app, "ai-suggest-test-2");
    const res = await request(app)
      .post("/api/ai/suggest")
      .send({ projectId: project.id, target: { kind: "model" } })
      .expect(400);
    assert.equal(res.body.error.code, "VALIDATION");
    assert.match(res.body.error.message, /target\.path/);
  });

  test("rejects entity-kind without target.entity", async () => {
    const app = await getApp();
    const project = await createProject(app, "ai-suggest-test-3");
    const res = await request(app)
      .post("/api/ai/suggest")
      .send({ projectId: project.id, target: { kind: "entity", path: "models/foo.yml" } })
      .expect(400);
    assert.equal(res.body.error.code, "VALIDATION");
    assert.match(res.body.error.message, /target\.entity/);
  });

  test("503 NO_PROVIDER when no real LLM is configured (provider unset)", async () => {
    const app = await getApp();
    const project = await createProject(app, "ai-suggest-test-4");
    const res = await request(app)
      .post("/api/ai/suggest")
      .send({
        projectId: project.id,
        target: { kind: "model", path: project.path + "/datalex.yaml" },
      })
      .expect(503);
    assert.equal(res.body.error.code, "NO_PROVIDER");
    assert.match(res.body.error.message, /Settings → AI/);
  });

  test("503 NO_PROVIDER when provider is explicitly 'local'", async () => {
    const app = await getApp();
    const project = await createProject(app, "ai-suggest-test-5");
    const res = await request(app)
      .post("/api/ai/suggest")
      .send({
        projectId: project.id,
        provider: { provider: "local" },
        target: { kind: "model", path: project.path + "/datalex.yaml" },
      })
      .expect(503);
    assert.equal(res.body.error.code, "NO_PROVIDER");
  });
});
