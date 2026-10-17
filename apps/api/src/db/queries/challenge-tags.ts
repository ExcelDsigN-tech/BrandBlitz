import { query } from "../index";

export interface ChallengeTag {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

/**
 * List all admin-curated challenge tags.
 */
export async function getAllTags(): Promise<ChallengeTag[]> {
  const result = await query<ChallengeTag>(
    `SELECT id, name, slug, created_at
     FROM challenge_tags
     ORDER BY name ASC`
  );
  return result.rows;
}

/**
 * Create a new admin-curated tag.
 */
export async function createTag(name: string, slug: string): Promise<ChallengeTag> {
  const result = await query<ChallengeTag>(
    `INSERT INTO challenge_tags (name, slug)
     VALUES ($1, $2)
     RETURNING id, name, slug, created_at`,
    [name, slug]
  );
  return result.rows[0];
}

/**
 * Delete a tag by id (cascades challenge_tag_map entries).
 */
export async function deleteTag(tagId: string): Promise<void> {
  await query(`DELETE FROM challenge_tags WHERE id = $1`, [tagId]);
}

/**
 * Assign tags to a challenge (idempotent — ignores duplicates).
 */
export async function assignTagsToChallenge(
  challengeId: string,
  tagIds: string[]
): Promise<void> {
  if (tagIds.length === 0) return;
  for (const tagId of tagIds) {
    await query(
      `INSERT INTO challenge_tag_map (challenge_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [challengeId, tagId]
    );
  }
}

/**
 * Remove all tags from a challenge, then reassign the given set.
 */
export async function setTagsForChallenge(
  challengeId: string,
  tagIds: string[]
): Promise<void> {
  await query(`DELETE FROM challenge_tag_map WHERE challenge_id = $1`, [challengeId]);
  await assignTagsToChallenge(challengeId, tagIds);
}

/**
 * Get tags for a specific challenge.
 */
export async function getTagsForChallenge(challengeId: string): Promise<ChallengeTag[]> {
  const result = await query<ChallengeTag>(
    `SELECT t.id, t.name, t.slug, t.created_at
     FROM challenge_tags t
     JOIN challenge_tag_map m ON m.tag_id = t.id
     WHERE m.challenge_id = $1
     ORDER BY t.name ASC`,
    [challengeId]
  );
  return result.rows;
}

/**
 * Get challenges that have a given tag (returns challenge ids).
 * Used internally for tag-based filtering.
 */
export async function getChallengeIdsByTagSlug(tagSlug: string): Promise<string[]> {
  const result = await query<{ challenge_id: string }>(
    `SELECT m.challenge_id
     FROM challenge_tag_map m
     JOIN challenge_tags t ON t.id = m.tag_id
     WHERE t.slug = $1`,
    [tagSlug]
  );
  return result.rows.map((r) => r.challenge_id);
}
