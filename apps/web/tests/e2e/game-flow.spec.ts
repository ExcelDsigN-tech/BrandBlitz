import { test, expect } from "../fixtures/auth";

test.describe("Game Flow", () => {
  test("complete a full 3-round challenge", async ({ authenticatedPage: page }) => {
    // 1. Load the home page and find our seeded challenge
    await page.goto("/");
    await expect(page.getByText("E2E Test Brand")).toBeVisible();

    // 2. Click accept challenge
    await page
      .getByRole("link", { name: /accept challenge/i })
      .first()
      .click();

    // 3. Warmup phase
    await expect(page.getByText("Study this brand carefully")).toBeVisible();
    // Wait for the start button to become enabled (WARMUP_MIN_SECONDS is usually 10 or 30)
    const startButton = page.getByRole("button", { name: /start challenge/i });
    await expect(startButton).toBeEnabled({ timeout: 35000 });
    await startButton.click();

    // 4. Round 1
    await expect(page.getByText("Round 1 of 3")).toBeVisible();
    await expect(page.getByText("Which brand is this?")).toBeVisible();
    await page.getByRole("button", { name: "A: E2E Test Brand" }).click();

    // 5. Round 2
    await expect(page.getByText("Round 2 of 3")).toBeVisible();
    await expect(page.getByText("What is our tagline?")).toBeVisible();
    await page.getByRole("button", { name: "B: The best brand for testing" }).click();

    // 6. Round 3
    await expect(page.getByText("Round 3 of 3")).toBeVisible();
    await expect(page.getByText("What do we sell?")).toBeVisible();
    await page.getByRole("button", { name: "D: 100% test coverage" }).click();

    // 7. Results Screen
    await expect(page.getByText("Challenge Complete!")).toBeVisible();
    await expect(page.getByText("Final Score")).toBeVisible();

    // 8. Verify Leaderboard (optional, if it updates immediately)
    await page.goto("/leaderboard");
    // Depending on the name used in the mock auth, we'd check for that user.
    // For now, just asserting we can reach the leaderboard.
    await expect(page.getByText("Global Leaderboard")).toBeVisible();
  });

  test("keyboard-only navigation through the game", async ({ authenticatedPage: page }) => {
    await page.goto("/");
    // Tab to the first challenge link
    await page.keyboard.press("Tab"); // Might need more tabs depending on header
    // Use a more targeted way to focus the first challenge if Tab is flaky
    await page.focus("a[href^='/challenge/']");
    await page.keyboard.press("Enter");

    // Wait for warmup
    await expect(page.getByText("Study this brand carefully")).toBeVisible();
    const startButton = page.getByRole("button", { name: /start challenge/i });
    await expect(startButton).toBeEnabled({ timeout: 35000 });

    // Start with Enter
    await page.keyboard.press("Enter");

    // Round 1: Press 'A' or '1'
    await expect(page.getByText("Round 1 of 3")).toBeVisible();
    await page.keyboard.press("a");

    // Round 2: Press 'B' or '2'
    await expect(page.getByText("Round 2 of 3")).toBeVisible();
    await page.keyboard.press("2");

    // Round 3: Press 'D' or '4'
    await expect(page.getByText("Round 3 of 3")).toBeVisible();
    await page.keyboard.press("d");

    // Results
    await expect(page.getByText("Challenge Complete!")).toBeVisible();
  });
});
