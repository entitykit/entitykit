import { expect, test } from "@playwright/test";

test("renders the publication and its JSON surface", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Lantern Journal" }))
    .toBeVisible();
  await expect(page.getByRole("link", { name: /Read essay/ }).first()).toBeVisible();

  const response = await request.get("/api/posts");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { data: unknown[]; meta: { count: number } };
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.meta.count).toBe(body.data.length);
});

test("creates and publishes a draft through Server Actions", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const title = `A field note ${suffix}`;

  await page.goto("/studio");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Deck").fill("A durable test of the editorial path.");
  await page.getByLabel("Essay").fill(
    "The first paragraph proves the mutation.\n\nThe second proves persistence.",
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");

  const row = page.locator(".studio-row", { hasText: title });
  await expect(row).toContainText("draft");
  await row.getByRole("button", { name: "Publish" }).click();
  await expect(row).toContainText("published");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
