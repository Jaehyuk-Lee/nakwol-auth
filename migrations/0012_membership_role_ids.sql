ALTER TABLE memberships ADD COLUMN role_ids TEXT NOT NULL DEFAULT '[]';

-- Existing membership snapshots predate the seasonal contract. They cannot
-- confer access; live Discord verification repopulates them on the next check.
UPDATE memberships SET role = 'user', status = 'inactive', role_ids = '[]', checked_at = 0;
