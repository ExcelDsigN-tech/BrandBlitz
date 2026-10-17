import { test, expect } from "@playwright/test";

test("round 1 timeout submits no-answer and yields 0 points", async ({ page }) => {
  await page.goto("/challenge/test-challenge-id");

  const roundOneAnswerResponse = page.waitForResponse((response) => {
    return (
      response.url().includes("/sessions/test-challenge-id/answer/1") &&
      response.request().method() === "POST"
    );
  });

  // Let round 1 expire naturally without clicking any option.
  await page.waitForTimeout(16_000);

  const response = await roundOneAnswerResponse;
  const requestBody = response.request().postDataJSON() as {
    selectedOption: "A" | "B" | "C" | "D" | null;
    reactionTimeMs: number;
  };
  const payload = (await response.json()) as { score: number; round: number };

  expect(requestBody.selectedOption).toBeNull();
  expect(payload.round).toBe(1);
  expect(payload.score).toBe(0);
});
