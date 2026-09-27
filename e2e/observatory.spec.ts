import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("inspect actual execution, replay past state, recall, drift, and guardian rejection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "01 First repair" }).click();
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Run completed",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /The solution was edited/ }).click();
  const inspector = page.getByRole("region", { name: "Event inspector" });
  await expect(inspector).toContainText("folder");
  await expect(inspector).toContainText("collection");
  await expect(
    page.getByRole("complementary", { name: "State after selected event" }),
  ).toContainText("No verified procedure at this step");
  await page.getByRole("button", { name: /Independent checks failed/ }).click();
  await expect(inspector).toContainText("Expected by host");
  await expect(inspector).toContainText("Actually returned");
  await page.getByRole("button", { name: /Diagnose before retrying/ }).click();
  await expect(inspector).toContainText("handwritten controller scores");
  await page.getByRole("button", { name: "Raw event", exact: true }).click();
  await expect(inspector).toContainText('"selected": "diagnose_contract"');
  await page.getByRole("button", { name: "Explanation", exact: true }).click();
  await page.screenshot({
    path: ".system3-pi/observatory-desktop.png",
    fullPage: true,
  });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        message: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.getByRole("button", { name: "02 Reuse a lesson" }).click();
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Run completed",
    { timeout: 15_000 },
  );
  await page
    .getByRole("button", { name: /A verified lesson was retrieved/ })
    .click();
  await expect(inspector).toContainText("collection");
  await page.getByRole("button", { name: "03 Contract drift" }).click();
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Run completed",
    { timeout: 15_000 },
  );
  await page
    .getByRole("button", { name: /The old lesson was invalidated/ })
    .click();
  await expect(inspector).toContainText("collection");
  await page.getByRole("button", { name: "05 Test the guardian" }).click();
  await page.getByRole("button", { name: "Run agent", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Run completed",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /Blocked delete_sentinel/ }).click();
  await expect(inspector).toContainText("Execution prevented");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Execution trace" }),
  ).toContainText("Blocked delete_sentinel");
  await page
    .getByRole("region", { name: "Run history" })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Execution trace" }),
  ).toContainText("Blocked delete_sentinel");
});

test("keyboard controls, cancellation, mobile layout, and architecture disclosure", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "01 First repair" }).click();
  await page
    .getByRole("button", { name: "Run agent", exact: true })
    .press("Enter");
  await page.getByRole("button", { name: "Stop run" }).click();
  await expect(page.getByRole("status").first()).toContainText("Run stopped", {
    timeout: 10_000,
  });
  await expect(
    page.getByText("Run stopped: cancelled.", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toward Sophia" }).press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "persistent colleague",
  );
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        message: n.failureSummary,
      })),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".system3-pi/observatory-mobile.png",
    fullPage: true,
  });
});
