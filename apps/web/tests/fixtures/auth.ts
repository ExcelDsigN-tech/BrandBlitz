import { test as base } from "@playwright/test";

/**
 * Fixture for programmatic authentication in E2E tests.
 * Avoids the slow UI-based login flow.
 */
export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    // In a real app, you might want to sign a JWT or set a session cookie here.
    // For this demo, we'll assume the app can be tricked by a mock cookie
    // or we'll need a real session from a test user.
    // Since we're using NextAuth, we'd ideally set the 'next-auth.session-token' cookie.

    // For now, let's just use a placeholder that tests can override or use.
    await page.context().addCookies([
      {
        name: "next-auth.session-token",
        value: "mock-session-token", // You'd generate a real one in a full implementation
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await use(page);
  },
});

export { expect } from "@playwright/test";
