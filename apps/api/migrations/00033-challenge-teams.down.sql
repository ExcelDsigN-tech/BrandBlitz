-- Down migration 00033: challenge_teams
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS challenge_teams CASCADE;
