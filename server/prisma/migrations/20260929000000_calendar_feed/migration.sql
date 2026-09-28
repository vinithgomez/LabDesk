-- Calendar feeds (Phase 7): the feed URL's token is an HMAC over the user id
-- and this version (see src/auth/ics-token.ts), so no token is ever stored.
-- Regenerating a user's feed bumps the version, which invalidates every
-- earlier URL at once.
ALTER TABLE "users"
  ADD COLUMN "ics_feed_version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "users_ics_feed_version_check" CHECK ("ics_feed_version" >= 1);
