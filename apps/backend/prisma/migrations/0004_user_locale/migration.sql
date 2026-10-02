-- User interface language preference chosen with the Mini App / admin flag
-- selector. 'en' (English) or 'zh' (Simplified Chinese). The bot uses it to
-- localize the post-claim wallet message and /wallet replies.
ALTER TABLE "User"
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
