import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import yaml from "js-yaml";
import { getApp, createProject } from "./helpers/harness.js";

function writeDbtFixture(project) {
  writeFileSync(join(project.path, "dbt_project.yml"), "name: enterprise_test\nversion: '1.0'\n", "utf-8");
  mkdirSync(join(project.path, "target"), { recursive: true });
  writeFileSync(
    join(project.path, "target", "manifest.json"),
    JSON.stringify({
      metadata: { project_name: "enterprise_test", adapter_type: "duckdb" },
      nodes: {
        "model.enterprise_test.fct_orders": {
          resource_type: "model",
          unique_id: "model.enterprise_test.fct_orders",
          name: "fct_orders",
          original_file_path: "models/marts/commerce/fct_orders.sql",
          description: "Order revenue fact table.",
          config: { materialized: "table", contract: { enforced: false }, meta: { owner: "analytics" } },
          columns: {
            order_id: { name: "order_id", data_type: "integer", description: "Order key." },
            customer_id: { name: "customer_id", data_type: "integer", description: "Customer key." },
            order_total: { name: "order_total", data_type: "numeric", description: "Order revenue." },
          },
        },
        "test.enterprise_test.unique_fct_orders_order_id": {
          resource_type: "test",
          unique_id: "test.enterprise_test.unique_fct_orders_order_id",
          attached_node: "model.enterprise_test.fct_orders",
          column_name: "order_id",
          test_metadata: { name: "unique" },
        },
      },
      metrics: {
        "metric.enterprise_test.revenue": {
          name: "revenue",
          type: "simple",
          label: "Revenue",
        },
      },
      semantic_models: {
        "semantic_model.enterprise_test.orders": {
          name: "orders",
          original_file_path: "models/marts/commerce/semantic.yml",
          measures: [{ name: "gross_revenue" }],
        },
      },
      exposures: {
        "exposure.enterprise_test.executive_revenue": {
          name: "executive_revenue",
          original_file_path: "models/marts/commerce/exposures.yml",
        },
      },
    }, null, 2),
    "utf-8",
  );
}

function installMockOpenAiProvider() {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(String(options.body || "{}"));
    const system = body.messages?.[0]?.content || "";
    const enterpriseGeneration = /DataLex enterprise AI/.test(system);
    const content = enterpriseGeneration
      ? JSON.stringify({
        business_domain: "Commerce",
        summary: "Commerce revenue certification pack generated from dbt evidence.",
        business_meaning: "Orders represent the commercial revenue event for the commerce domain.",
        proposal_type: "core_certification",
        target: "commerce revenue certification",
        files: [
          "commerce/contracts/commerce_core_certification.contract.yaml",
          "commerce/conceptual/commerce_core_certification.diagram.yaml",
          "commerce/logical/commerce_core_certification.diagram.yaml",
          "commerce/physical/commerce_core_certification.diagram.yaml",
          "commerce/semantic/revenue_metrics.metric.yaml",
          "commerce/glossary/revenue.term.yaml",
        ],
        evidence: {
          source_models: ["model.enterprise_test.fct_orders"],
          columns_used: ["order_id", "customer_id", "order_total"],
          existing_tests: ["order_id:unique"],
          semantic_metrics: ["revenue", "gross_revenue"],
          inferred_grain: "one row per order_id",
          assumptions: ["Revenue is represented by order_total until finance confirms adjustments."],
          confidence: 0.91,
          open_questions: ["Confirm refund and cancellation handling."],
        },
        review_notes: ["Review finance policy before certification."],
      })
      : JSON.stringify({ ok: true, message: "ready" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  };
  return () => {
    globalThis.fetch = priorFetch;
  };
}

describe("enterprise adoption workflow", () => {
  let app;
  let project;

  before(async () => {
    app = await getApp();
    project = createProject({ modelsDir: "DataLex" });
    writeDbtFixture(project);
  });

  after(() => project.cleanup());

  test("scans, generates, certifies, and builds a certified manifest", async () => {
    const scan = await request(app)
      .post("/api/enterprise/scan")
      .send({ projectId: project.id });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.detected.dbt_project, true);
    assert.equal(scan.body.detected.manifest_json, true);
    assert.equal(scan.body.totals.models, 1);
    assert.equal(scan.body.totals.missing_contracts, 1);
    assert.ok(existsSync(join(project.modelPath, "datalex.yaml")));
    assert.ok(scan.body.domains.some((domain) => domain.name === "unassigned"));
    assert.equal(scan.body.ai.ready, false);
    assert.equal(scan.body.integrations.dql.enabled, false);

    const blockedGenerate = await request(app)
      .post("/api/enterprise/generate")
      .send({ projectId: project.id, domain: "commerce" });
    assert.equal(blockedGenerate.status, 409);
    assert.equal(blockedGenerate.body.error.code, "AI_PROVIDER_REQUIRED");

    let generate;
    const restoreFetch = installMockOpenAiProvider();
    try {
      const providerTest = await request(app)
        .post("/api/ai/settings/test")
        .send({ projectId: project.id, provider: "openai", model: "gpt-4.1-mini", apiKey: "sk-test-secret" });
      assert.equal(providerTest.status, 200);
      assert.equal(providerTest.body.generation.ready, true);

      const settings = await request(app)
        .get(`/api/ai/settings?projectId=${encodeURIComponent(project.id)}`);
      assert.equal(settings.status, 200);
      assert.doesNotMatch(JSON.stringify(settings.body), /sk-test-secret/);
      assert.ok(existsSync(join(project.path, ".datalex", "agent", "provider-settings.json")));
      assert.equal(existsSync(join(project.modelPath, ".datalex", "agent", "provider-settings.json")), false);

      const priorOpenAiKey = process.env.OPENAI_API_KEY;
      const priorOpenAiModel = process.env.OPENAI_MODEL;
      process.env.OPENAI_API_KEY = "sk-env-secret";
      process.env.OPENAI_MODEL = "gpt-env-model";
      try {
        const envSettings = await request(app)
          .get(`/api/ai/settings?projectId=${encodeURIComponent(project.id)}`);
        assert.equal(envSettings.status, 200);
        const openai = envSettings.body.settings.providers.find((provider) => provider.id === "openai");
        assert.equal(openai.model, "gpt-env-model");
        assert.equal(openai.apiKeyPreview, "OPENAI_API_KEY=set");
        assert.equal(openai.source, "env+local");
        assert.doesNotMatch(JSON.stringify(envSettings.body), /sk-env-secret|sk-test-secret/);
      } finally {
        if (priorOpenAiKey == null) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = priorOpenAiKey;
        if (priorOpenAiModel == null) delete process.env.OPENAI_MODEL;
        else process.env.OPENAI_MODEL = priorOpenAiModel;
      }

      const context = await request(app)
        .post("/api/ai/context/build")
        .send({ projectId: project.id });
      assert.equal(context.status, 200);
      assert.equal(context.body.exists, true);
      assert.ok(context.body.recordCount > 0);

      generate = await request(app)
        .post("/api/enterprise/generate")
        .send({ projectId: project.id, domain: "unassigned" });
    } finally {
      restoreFetch();
    }
    assert.equal(generate.status, 200);
    assert.equal(generate.body.status, "generated");
    assert.equal(generate.body.path, "commerce/proposals/commerce_core_certification.proposal.yaml");
    assert.equal(generate.body.proposal.domain, "commerce");
    assert.equal(generate.body.proposal.proposal_type, "datalex_contract");
    assert.equal(generate.body.proposal.created_by, "datalex-enterprise-ai");
    assert.equal(generate.body.proposal.evidence.confidence, 0.91);
    assert.equal(generate.body.proposal.meta.source_domain, "unassigned");
    assert.deepEqual(generate.body.proposal.proposed_change.files, [
      "domains/commerce.yaml",
      "commerce/conceptual/commerce_core_certification.diagram.yaml",
      "commerce/logical/commerce_core_certification.diagram.yaml",
      "commerce/physical/commerce_core_certification.diagram.yaml",
      "commerce/contracts/commerce_core_certification.contract.yaml",
      "commerce/semantic/commerce_metrics.metric.yaml",
      "commerce/glossary/commerce.term.yaml",
      "generated/dbt/commerce/fct_orders.contract.yml",
    ]);
    assert.ok(existsSync(join(project.modelPath, generate.body.path)));

    const validate = await request(app)
      .post("/api/proposals/validate")
      .send({ projectId: project.id, proposalPath: generate.body.path });
    assert.equal(validate.status, 200);
    assert.equal(validate.body.valid, true);

    const reviewed = await request(app)
      .post("/api/proposals/apply")
      .send({ projectId: project.id, proposalPath: generate.body.path, status: "reviewed" });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.status, "reviewed");

    const certify = await request(app)
      .post("/api/proposals/certify")
      .send({ projectId: project.id, proposalPath: generate.body.path, status: "certified" });
    assert.equal(certify.status, 200);
    const writtenKinds = new Set(certify.body.written.map((item) => item.kind));
    for (const kind of ["domain", "diagram", "contract", "metric_contract", "term", "dbt_contract_suggestion"]) {
      assert.ok(writtenKinds.has(kind), `expected certified pack to write ${kind}`);
    }
    const contract = certify.body.written.find((item) => item.kind === "contract");
    assert.ok(contract?.path?.startsWith("commerce/contracts/"));
    const contractDoc = yaml.load(readFileSync(join(project.modelPath, contract.path), "utf-8"));
    assert.equal(contractDoc.kind, "contract");
    assert.equal(contractDoc.status, "certified");
    assert.ok(existsSync(join(project.modelPath, "commerce", "conceptual", "commerce_core_certification.diagram.yaml")));
    assert.ok(existsSync(join(project.modelPath, "commerce", "logical", "commerce_core_certification.diagram.yaml")));
    assert.ok(existsSync(join(project.modelPath, "commerce", "physical", "commerce_core_certification.diagram.yaml")));
    assert.ok(existsSync(join(project.modelPath, "commerce", "glossary", "commerce.term.yaml")));
    assert.ok(existsSync(join(project.modelPath, "generated", "dbt", "commerce", "fct_orders.contract.yml")));

    const manifest = await request(app)
      .post("/api/datalex/manifest/build")
      .send({ projectId: project.id });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.summary.contracts, 1);
    assert.equal(manifest.body.summary.metrics, 1);
    assert.ok(existsSync(join(project.modelPath, "datalex-manifest.json")));

    mkdirSync(join(project.path, "dql"), { recursive: true });
    const fakeDql = join(project.path, "fake-dql.sh");
    const fakeDqlArgs = join(project.path, "fake-dql-args.txt");
    writeFileSync(fakeDql, `#!/bin/sh\nprintf '%s\\n' "$@" > "${fakeDqlArgs}"\nexit 0\n`, "utf-8");
    chmodSync(fakeDql, 0o755);
    const priorDqlCli = process.env.DQL_CLI;
    process.env.DQL_CLI = fakeDql;
    try {
      const dqlReady = await request(app)
        .post("/api/dql/readiness")
        .send({ projectId: project.id, datalexManifest: manifest.body.fullPath });
      assert.equal(dqlReady.status, 200);
      assert.equal(dqlReady.body.compile.status, "passed");
      const args = readFileSync(fakeDqlArgs, "utf-8");
      assert.match(args, /compile/);
      assert.match(args, /--datalex-manifest/);
      assert.match(args, /datalex-manifest\.json/);
    } finally {
      if (priorDqlCli == null) delete process.env.DQL_CLI;
      else process.env.DQL_CLI = priorDqlCli;
    }

    const reject = await request(app)
      .post("/api/proposals/certify")
      .send({ projectId: project.id, proposalPath: generate.body.path, status: "rejected" });
    assert.equal(reject.status, 200);
    const rejectedContractDoc = yaml.load(readFileSync(join(project.modelPath, contract.path), "utf-8"));
    assert.equal(rejectedContractDoc.status, "rejected");

    const rejectedManifest = await request(app)
      .post("/api/datalex/manifest/build")
      .send({ projectId: project.id });
    assert.equal(rejectedManifest.status, 200);
    assert.equal(rejectedManifest.body.summary.contracts, 0);
    assert.equal(rejectedManifest.body.summary.metrics, 0);
  });

  test("large repos return bounded enterprise queues instead of raw model sprawl", async () => {
    const large = createProject({ modelsDir: "DataLex" });
    try {
      writeFileSync(join(large.path, "dbt_project.yml"), "name: enterprise_large\nversion: '1.0'\n", "utf-8");
      mkdirSync(join(large.path, "target"), { recursive: true });
      const nodes = {};
      for (let i = 0; i < 4000; i += 1) {
        const domain = `domain_${String(i % 12).padStart(2, "0")}`;
        const name = i % 7 === 0 ? `fct_orders_${i}` : `int_model_${i}`;
        nodes[`model.enterprise_large.${name}`] = {
          resource_type: "model",
          unique_id: `model.enterprise_large.${name}`,
          name,
          original_file_path: `models/marts/${domain}/${name}.sql`,
          description: i % 5 === 0 ? `Model ${i}` : "",
          config: { materialized: "table", contract: { enforced: i % 11 === 0 }, meta: { owner: i % 13 === 0 ? "" : "analytics" } },
          columns: {
            id: { name: "id", data_type: "integer" },
            customer_id: { name: "customer_id", data_type: "integer" },
            amount: { name: "amount", data_type: "numeric" },
          },
        };
      }
      const metrics = {};
      for (let i = 0; i < 3000; i += 1) {
        metrics[`metric.enterprise_large.revenue_metric_${i}`] = { name: `revenue_metric_${i}`, type: "simple" };
      }
      writeFileSync(
        join(large.path, "target", "manifest.json"),
        JSON.stringify({
          metadata: { project_name: "enterprise_large", adapter_type: "duckdb" },
          nodes,
          metrics,
          semantic_models: {},
          exposures: {},
        }),
        "utf-8",
      );

      const scan = await request(app)
        .post("/api/enterprise/scan")
        .send({ projectId: large.id });
      assert.equal(scan.status, 200);
      assert.equal(scan.body.totals.models, 4000);
      assert.equal(scan.body.totals.semantic_metrics, 3000);
      assert.ok(scan.body.domains.length <= 20, "expected domain rollups, not a model list");
      assert.ok(scan.body.domains.some((domain) => domain.name === "unassigned"));
      assert.equal(scan.body.domains.some((domain) => /^domain_/.test(domain.name)), false);
      assert.equal(scan.body.contract_opportunities.length, 200);
      assert.equal(scan.body.limits.contract_opportunities.truncated, true);
      assert.ok(scan.body.proposal_packs.length <= 50);
    } finally {
      large.cleanup();
    }
  });
});
