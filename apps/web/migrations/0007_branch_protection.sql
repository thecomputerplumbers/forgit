-- Default branches are unprotected unless an admin turns protection on, like GitHub.
-- Existing repositories read as unprotected here, but keep their walgit lock
-- until an admin saves Branch protection in the repository settings.
ALTER TABLE repository_rules ADD COLUMN protect_default_branch INTEGER NOT NULL DEFAULT 0;
