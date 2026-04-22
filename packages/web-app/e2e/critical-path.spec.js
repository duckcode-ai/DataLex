/* critical-path.spec.js — one big serial UI walk.
 *
 * Covers the "real user" journey on a cloned jaffle-shop checkout.
 * Steps gated with `E2E_FULL=1` require UI selectors that haven't
 * been pinned against the live app yet — enable those after a manual
 * walkthrough pass. The smoke portion (import + explorer populate +
 * Apply dialog wiring) runs unconditionally.
 *
 * A follow-up PR should drop the gate and wire concrete selectors
 * for rename-cascade / autosave / auto-commit.
 */
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const FULL = process.env.E2E_FULL === "1";

test.describe.configure({ mode: "serial" });

test.describe("DataLex critical path on jaffle-shop", () => {
  let projectDir;

  test.beforeAll(() => {
    projectDir = process.env.JAFFLE_SHOP_DIR;
    if (!projectDir) {
      throw new Error(
        "JAFFLE_SHOP_DIR not set — global-setup did not run. Use OFFLINE=1 to skip E2E."
      );
    }
  });

  test("smoke: import jaffle-shop, explorer populates, Apply dialog wired", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "datalex.onboarding.seen",
        JSON.stringify({ seen: true, seenAt: Date.now() })
      );
    });
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();

    await test.step("open Import dbt dialog via Cmd+K", async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByPlaceholder(/search|command/i).first().fill("Import dbt");
      await page.getByText(/Import dbt repo/i).first().click();
      await expect(page.getByRole("heading", { name: /Import dbt repo/i })).toBeVisible();
    });

    await test.step("import from local jaffle-shop clone", async () => {
      await page.getByRole("button", { name: /Local folder/i }).click();
      await page.getByLabel(/Local folder/i).fill(projectDir);
      await page.getByRole("button", { name: /^Import$/i }).click();
      await expect(page.getByRole("heading", { name: /Import complete/i })).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("open project from Results panel", async () => {
      await page.getByRole("button", { name: /open project/i }).first().click();
      await expect(page.getByRole("heading", { name: /Import complete/i })).toBeHidden();
    });

    await test.step("explorer lists jaffle-shop models", async () => {
      await expect(
        page.getByText(/stg_customers|customers\.ya?ml|orders\.ya?ml/i).first()
      ).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Apply-to-warehouse dialog is wired", async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByPlaceholder(/search|command/i).first().fill("Apply to warehouse");
      await page.getByText(/Apply to warehouse/i).first().click();
      await expect(page.getByRole("heading", { name: /Apply to warehouse/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Generate DDL/i })).toBeVisible();
    });
  });

  test("full loop: rename cascade + autosave + auto-commit + DDL dry run", async ({ page }) => {
    test.skip(!FULL, "Set E2E_FULL=1 to run selector-heavy steps (rename, autosave, auto-commit, DDL dry run).");

    await page.addInitScript(() => {
      localStorage.setItem(
        "datalex.onboarding.seen",
        JSON.stringify({ seen: true, seenAt: Date.now() })
      );
    });
    await page.goto("/");

    // Prelude: reach a project-opened state reusing the smoke path.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await page.getByPlaceholder(/search|command/i).first().fill("Import dbt");
    await page.getByText(/Import dbt repo/i).first().click();
    await page.getByRole("button", { name: /Local folder/i }).click();
    await page.getByLabel(/Local folder/i).fill(projectDir);
    await page.getByRole("button", { name: /^Import$/i }).click();
    await expect(page.getByRole("heading", { name: /Import complete/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /open project/i }).first().click();

    await test.step("rename entity cascades across siblings", async () => {
      // TODO: pin selectors after a manual UI walkthrough.
      //  - Click a model file in the Explorer
      //  - Open inspector → Entity tab
      //  - Click "Rename entity…" button
      //  - Enter new name in the rename dialog → Rename
      //  - Assert toast with "Renamed … in N files" appears
      throw new Error("selectors for rename-entity flow not yet pinned");
    });

    await test.step("field edit autosaves within 1.5s", async () => {
      // TODO: selectors for inspector column-type select.
      //  - Change a column type via Inspector → Columns
      //  - Wait 1500ms
      //  - await page.reload()
      //  - Assert the new type is still present
      throw new Error("selectors for field-edit flow not yet pinned");
    });

    await test.step("auto-commit coalesces bursty edits into one commit", async () => {
      const before = countCommits(projectDir);
      // TODO: CommitDialog → toggle auto-commit; perform 3 rapid edits;
      // wait ~3s for the 2s debounce to fire.
      const after = countCommits(projectDir);
      expect(after - before).toBe(1);
    });

    await test.step("Apply to warehouse: generate DDL + dry run", async () => {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
      await page.getByPlaceholder(/search|command/i).first().fill("Apply to warehouse");
      await page.getByText(/Apply to warehouse/i).first().click();
      // Dialect dropdown → duckdb (stable for CI; no creds needed).
      await page.locator("select").first().selectOption({ label: "DuckDB" }).catch(() => {});
      await page.getByRole("button", { name: /Generate DDL/i }).click();
      await expect(page.getByText(/Generated DDL/i)).toBeVisible({ timeout: 30_000 });
    });
  });
});

function countCommits(dir) {
  try {
    const out = execSync("git rev-list --count HEAD", { cwd: dir, encoding: "utf8" });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}
