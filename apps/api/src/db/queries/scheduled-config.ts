import { query } from "../index";

export type ScheduledChangeStatus = "pending" | "applied" | "cancelled";

export interface ScheduledConfigChange {
  id: string;
  config_key: string;
  value: Record<string, unknown>;
  effective_at: string;
  status: ScheduledChangeStatus;
  created_by: string;
  applied_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
}

/**
 * Schedule a config change to take effect at a future time.
 */
export async function createScheduledConfigChange(data: {
  configKey: string;
  value: Record<string, unknown>;
  effectiveAt: string;
  createdBy: string;
}): Promise<ScheduledConfigChange> {
  const result = await query<ScheduledConfigChange>(
    `INSERT INTO scheduled_config_changes
       (config_key, value, effective_at, created_by)
     VALUES ($1, $2::jsonb, $3, $4)
     RETURNING *`,
    [data.configKey, JSON.stringify(data.value), data.effectiveAt, data.createdBy]
  );
  return result.rows[0];
}

/**
 * List scheduled config changes, optionally filtered by status.
 * Ordered by effective_at ascending (soonest first).
 */
export async function listScheduledConfigChanges(opts?: {
  status?: ScheduledChangeStatus;
  configKey?: string;
  limit?: number;
}): Promise<ScheduledConfigChange[]> {
  const { status, configKey, limit = 100 } = opts ?? {};
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status) {
    params.push(status);
    conditions.push(`status = $${idx++}`);
  }
  if (configKey) {
    params.push(configKey);
    conditions.push(`config_key = $${idx++}`);
  }

  params.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query<ScheduledConfigChange>(
    `SELECT * FROM scheduled_config_changes
     ${where}
     ORDER BY effective_at ASC
     LIMIT $${idx}`,
    params
  );
  return result.rows;
}

/**
 * Fetch a single scheduled config change by id.
 */
export async function getScheduledConfigChangeById(
  id: string
): Promise<ScheduledConfigChange | null> {
  const result = await query<ScheduledConfigChange>(
    "SELECT * FROM scheduled_config_changes WHERE id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Cancel a pending scheduled change. Returns null if not found or not pending.
 */
export async function cancelScheduledConfigChange(
  id: string,
  cancelledBy: string
): Promise<ScheduledConfigChange | null> {
  const result = await query<ScheduledConfigChange>(
    `UPDATE scheduled_config_changes
     SET status       = 'cancelled',
         cancelled_at = NOW(),
         cancelled_by = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, cancelledBy]
  );
  return result.rows[0] ?? null;
}

/**
 * Mark a scheduled change as applied (called by the processor after setConfig).
 */
export async function markScheduledConfigChangeApplied(
  id: string
): Promise<ScheduledConfigChange | null> {
  const result = await query<ScheduledConfigChange>(
    `UPDATE scheduled_config_changes
     SET status     = 'applied',
         applied_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch all pending changes whose effective_at has passed.
 * Used by the processor to find work to do.
 */
export async function getDueScheduledConfigChanges(): Promise<ScheduledConfigChange[]> {
  const result = await query<ScheduledConfigChange>(
    `SELECT * FROM scheduled_config_changes
     WHERE status = 'pending' AND effective_at <= NOW()
     ORDER BY effective_at ASC`,
    []
  );
  return result.rows;
}
