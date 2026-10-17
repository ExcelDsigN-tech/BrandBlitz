// Issue #1017: Cron endpoint for scheduled brand digest emails
import { Router } from "express";
import { processBrandDigests } from "../../jobs/brand-digest";

const router = Router();

/**
 * POST /cron/brand-digest/daily
 * Trigger daily brand digest processing.
 * Expected to be called by a scheduler (GitHub Actions, cron, cloud scheduler, etc.)
 */
router.post("/daily", async (req, res) => {
  try {
    const result = await processBrandDigests("daily");
    res.json({
      success: true,
      frequency: "daily",
      ...result,
    });
  } catch (error) {
    console.error("[cron/brand-digest/daily] Failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /cron/brand-digest/weekly
 * Trigger weekly brand digest processing.
 */
router.post("/weekly", async (req, res) => {
  try {
    const result = await processBrandDigests("weekly");
    res.json({
      success: true,
      frequency: "weekly",
      ...result,
    });
  } catch (error) {
    console.error("[cron/brand-digest/weekly] Failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /cron/brand-digest/monthly
 * Trigger monthly brand digest processing.
 */
router.post("/monthly", async (req, res) => {
  try {
    const result = await processBrandDigests("monthly");
    res.json({
      success: true,
      frequency: "monthly",
      ...result,
    });
  } catch (error) {
    console.error("[cron/brand-digest/monthly] Failed:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
