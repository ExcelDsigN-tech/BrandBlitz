import { query } from "../index";

export type BrandMemberRole = "owner" | "editor" | "viewer";

export interface BrandMember {
  id: string;
  brand_id: string;
  user_id: string | null;
  email: string;
  role: BrandMemberRole;
  invited_by: string;
  created_at: string;
  updated_at: string;
  // Joined fields if available
  user_display_name?: string | null;
  user_username?: string | null;
  user_avatar_url?: string | null;
}

/**
 * Returns the highest role a user has for a brand, or null if they have no access.
 * If user is the direct brand owner in `brands.owner_user_id`, they automatically have 'owner' role.
 */
export async function getBrandMemberRole(
  brandId: string,
  userId: string,
  userEmail?: string
): Promise<BrandMemberRole | null> {
  // Check if brand exists and user is owner
  const brandRes = await query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM brands WHERE id = $1 AND deleted_at IS NULL`,
    [brandId]
  );
  if (brandRes.rows.length === 0) return null;

  if (brandRes.rows[0].owner_user_id === userId) {
    return "owner";
  }

  // Check brand_members table by user_id or email
  const memberRes = await query<{ role: BrandMemberRole }>(
    `SELECT role FROM brand_members
     WHERE brand_id = $1
       AND (user_id = $2 OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3)))
     ORDER BY CASE role
       WHEN 'owner' THEN 1
       WHEN 'editor' THEN 2
       WHEN 'viewer' THEN 3
       ELSE 4
     END ASC
     LIMIT 1`,
    [brandId, userId, userEmail ?? null]
  );

  return memberRes.rows[0]?.role ?? null;
}

/**
 * Check if a user has at least the required role for a brand.
 * Hierarchy: owner > editor > viewer
 */
export function hasRequiredBrandRole(
  userRole: BrandMemberRole | null,
  requiredRole: BrandMemberRole
): boolean {
  if (!userRole) return false;
  if (userRole === "owner") return true;
  if (userRole === "editor") return requiredRole === "editor" || requiredRole === "viewer";
  if (userRole === "viewer") return requiredRole === "viewer";
  return false;
}

/**
 * List all members of a brand.
 */
export async function getBrandMembers(brandId: string): Promise<BrandMember[]> {
  const result = await query<BrandMember>(
    `SELECT
       bm.id,
       bm.brand_id,
       bm.user_id,
       bm.email,
       bm.role,
       bm.invited_by,
       bm.created_at,
       bm.updated_at,
       u.display_name AS user_display_name,
       u.username AS user_username,
       u.avatar_url AS user_avatar_url
     FROM brand_members bm
     LEFT JOIN users u ON u.id = bm.user_id
     WHERE bm.brand_id = $1
     ORDER BY
       CASE bm.role
         WHEN 'owner' THEN 1
         WHEN 'editor' THEN 2
         WHEN 'viewer' THEN 3
         ELSE 4
       END ASC,
       bm.created_at ASC`,
    [brandId]
  );

  return result.rows;
}

/**
 * Invite / add a member to a brand.
 */
export async function addBrandMember(data: {
  brandId: string;
  email: string;
  role: BrandMemberRole;
  invitedBy: string;
}): Promise<BrandMember> {
  const normalizedEmail = data.email.trim().toLowerCase();

  // Check if a registered user with this email already exists
  const userRes = await query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [normalizedEmail]
  );
  const matchedUserId = userRes.rows[0]?.id ?? null;

  const result = await query<BrandMember>(
    `INSERT INTO brand_members (brand_id, user_id, email, role, invited_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (brand_id, email)
     DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
     RETURNING *`,
    [data.brandId, matchedUserId, normalizedEmail, data.role, data.invitedBy]
  );

  return result.rows[0];
}

/**
 * Remove a member from a brand.
 * Ensures the primary owner cannot be removed if they are the only owner.
 */
export async function removeBrandMember(
  brandId: string,
  memberId: string
): Promise<BrandMember | null> {
  const member = await query<BrandMember>(
    `SELECT * FROM brand_members WHERE id = $1 AND brand_id = $2`,
    [memberId, brandId]
  );
  if (member.rows.length === 0) return null;

  // Check if target member is owner and if there are other owners
  if (member.rows[0].role === "owner") {
    const ownerCountRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM brand_members WHERE brand_id = $1 AND role = 'owner'`,
      [brandId]
    );
    if (parseInt(ownerCountRes.rows[0].count, 10) <= 1) {
      throw new Error("CANNOT_REMOVE_LAST_OWNER");
    }
  }

  const result = await query<BrandMember>(
    `DELETE FROM brand_members WHERE id = $1 AND brand_id = $2 RETURNING *`,
    [memberId, brandId]
  );

  return result.rows[0] ?? null;
}
