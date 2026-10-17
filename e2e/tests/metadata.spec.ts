import { test, expect } from "@playwright/test";

test.describe("Metadata", () => {
  test("root metadata is present on home page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/BrandBlitz — Stellar Edition/);
    const description = await page.locator("meta[name='description']").getAttribute("content");
    expect(description).toContain("Brands deposit USDC on Stellar");

    const ogTitle = await page.locator("meta[property='og:title']").getAttribute("content");
    expect(ogTitle).toBe("BrandBlitz");

    const ogImage = await page.locator("meta[property='og:image']").getAttribute("content");
    expect(ogImage).toContain("og-default.png");

    const twitterCard = await page.locator("meta[name='twitter:card']").getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");
  });

  test("challenge page has dynamic metadata", async ({ page }) => {
    // We need a challenge ID. We'll try to find one on the home page or use a placeholder.
    await page.goto("/");
    const challengeLink = page.locator("a[href^='/challenge/']").first();

    // If no challenges are active, we might need a fallback or mock
    if ((await challengeLink.count()) > 0) {
      const href = await challengeLink.getAttribute("href");
      const id = href?.split("/").pop();
      await page.goto(`/challenge/${id}`);

      // Title should contain "Challenge" and "USDC"
      await expect(page).toHaveTitle(/Challenge — Win .* USDC/);

      const ogImage = await page.locator("meta[property='og:image']").getAttribute("content");
      expect(ogImage).toContain(`/api/og/challenge/${id}`);
    } else {
      console.warn("No active challenges found to test metadata.");
    }
  });

  test("profile page has dynamic metadata", async ({ page }) => {
    // We'll use a known test username if possible, or just skip if not found
    await page.goto("/leaderboard");
    const profileLink = page.locator("a[href^='/profile/']").first();

    if ((await profileLink.count()) > 0) {
      const href = await profileLink.getAttribute("href");
      const username = href?.split("/").pop();
      await page.goto(`/profile/${username}`);

      // Title should contain @username
      await expect(page).toHaveTitle(new RegExp(`@${username}`));

      const ogTitle = await page.locator("meta[property='og:title']").getAttribute("content");
      expect(ogTitle).toContain(username);
    } else {
      console.warn("No profiles found on leaderboard to test metadata.");
    }
  });

  test("leaderboard page has correct metadata", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page).toHaveTitle(/Global Leaderboard | BrandBlitz/);
    const description = await page.locator("meta[name='description']").getAttribute("content");
    expect(description).toContain("top performers");
  });
});
