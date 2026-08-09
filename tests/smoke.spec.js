import { mkdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const screenshotDir = "output/playwright";
const adminToken = "playwright-admin-token-0123456789";

function safeName(value) {
  return value.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

async function saveScreenshot(page, testInfo, name) {
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: `${screenshotDir}/${safeName(testInfo.project.name)}-${name}.png`,
    fullPage: true,
  });
}

async function expectNoSeriousConsole(page, run) {
  const problems = [];
  const expectedMessages = new Set([
    "Failed to load resource: the server responded with a status of 404 (Not Found)",
  ]);

  page.on("console", (message) => {
    if (message.type() === "error" && !expectedMessages.has(message.text())) {
      problems.push(message.text());
    }
  });
  page.on("pageerror", (error) => problems.push(error.message));

  await run();

  expect(problems).toEqual([]);
}

async function unlockAdmin(page) {
  await expect(page.getByRole("heading", { name: "Admin access" })).toBeVisible();
  await page.getByLabel("Admin token").fill(adminToken);
  await page.getByRole("button", { name: "Unlock dashboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Nova Commerce Admin", exact: true })
  ).toBeVisible();
}

test("chat home loads, validates input, sends a lead, and survives refresh", async ({
  page,
}, testInfo) => {
  await expectNoSeriousConsole(page, async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Nova Commerce", exact: true })).toBeVisible();
    await expect(page.getByText("Demo mode")).toBeVisible();
    await expect(
      page.getByText("Ask about a product, order, delivery, return, or availability.")
    ).toBeVisible();

    await saveScreenshot(page, testInfo, "home");

    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Type a message before sending.")).toBeVisible();

    const message =
      `Hello, my name is Smoke ${testInfo.project.name}. ` +
      `I want to buy Aurora Wireless Earbuds. My email is smoke-${safeName(testInfo.project.name)}@example.com.`;

    await page.route("**/api/chat", async (route) => {
      await page.waitForTimeout(250);
      await route.continue();
    });
    await page.getByLabel("Message").fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Sending" })).toBeDisabled();
    await expect(page.getByText("Lead saved")).toBeVisible();
    await expect(page.getByText("pending request for the store team")).toBeVisible();

    await page.reload();
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByText("pending request for the store team")).toBeVisible();
    await expect(
      page.evaluate(() => localStorage.getItem("ai-commerce-session-id"))
    ).resolves.toBeTruthy();
    await expect(
      page.evaluate(() => localStorage.getItem("ai-commerce-session-token")?.length)
    ).resolves.toBe(43);

    await page.getByRole("button", { name: "New" }).click();
    await expect(
      page.getByText("Ask about a product, order, delivery, return, or availability.")
    ).toBeVisible();
    await expect(
      page.evaluate(() => localStorage.getItem("ai-commerce-session-token"))
    ).resolves.toBeNull();

    await page.getByRole("link", { name: "Open Admin" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await unlockAdmin(page);
  });
});

test("quick actions, admin status updates, API validation, and 404 work", async ({
  page,
  request,
}, testInfo) => {
  await expectNoSeriousConsole(page, async () => {
    const email = `admin-${safeName(testInfo.project.name)}@example.com`;

    const emptyChatResponse = await request.post("/api/chat", {
      data: { message: "" },
    });
    expect(emptyChatResponse.status()).toBe(400);
    await expect(await emptyChatResponse.json()).toEqual({ error: "Message is required." });

    await request.post("/api/chat", {
      data: {
        message: `My name is Admin ${testInfo.project.name}. I need FlexCharge 3-in-1 Dock. Email ${email}.`,
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Product recommendation" }).click();
    await expect(page.getByText("What product or order can I help with today?")).toBeVisible();

    await page.goto("/admin");
    await unlockAdmin(page);
    await expect(page.getByRole("row").filter({ hasText: email })).toBeVisible();
    await saveScreenshot(page, testInfo, "admin");

    const leadRow = page.getByRole("row").filter({ hasText: email });
    await leadRow.getByRole("combobox").selectOption("contacted");
    await expect(
      page.getByRole("row").filter({ hasText: email }).getByRole("combobox")
    ).toHaveValue("contacted");

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("row").filter({ hasText: email })).toBeVisible();

    const missingResponse = await page.goto("/definitely-not-here");
    expect(missingResponse.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await saveScreenshot(page, testInfo, "404");
  });
});
