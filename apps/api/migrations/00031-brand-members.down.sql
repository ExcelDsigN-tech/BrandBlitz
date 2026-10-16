-- Down migration 00031: brand_members
DROP TABLE IF EXISTS brand_members CASCADE;
DROP TYPE IF EXISTS brand_member_role;
