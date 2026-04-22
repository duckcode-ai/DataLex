/* import-api.spec.js — backend contract regression gate.
 *
 * Stable, DOM-free coverage of the /api/dbt/import surface against a
 * real jaffle-shop clone. This catches api-server/core-engine breakage
 * independent of selector drift in the UI specs.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:3006";

test.describe("dbt import API against real jaffle-shop", () => {
  test("POST /api/dbt/import (local folder, skip warehouse) returns tree + report", async ({ request }) => {
    const projectDir = process.env.JAFFLE_SHOP_DIR;
    test.skip(!projectDir, "global-setup did not expose JAFFLE_SHOP_DIR");

    const res = await request.post(`${API}/api/dbt/import`, {
      data: {
        projectDir,
        skipWarehouse: true,
        editInPlace: false,
      },
      timeout: 60_000,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();

    // Tree: at minimum the canonical jaffle-shop models show up.
    expect(Array.isArray(body.tree)).toBe(true);
    expect(body.tree.length).toBeGreaterThan(3);
    const paths = body.tree.map((f) => f.path);
    const joined = paths.join("\n");
    expect(joined).toMatch(/customers/i);
    expect(joined).toMatch(/orders/i);

    // Report: the SyncReport shape Phase 2 depends on.
    expect(body.report).toBeTruthy();
    expect(typeof body.report).toBe("object");
  });

  test("POST /api/dbt/import rejects missing projectDir", async ({ request }) => {
    const res = await request.post(`${API}/api/dbt/import`, {
      data: { skipWarehouse: true },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
