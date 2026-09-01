-- Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
-- Licensed under the Apache License, Version 2.0.
--
-- Reverses 0002. Going back loses the sub-second part of any stored value,
-- rounded to the nearest second by MySQL, which is the precision these columns
-- had before the migration.

ALTER TABLE team_session
  MODIFY COLUMN finished_at  TIMESTAMP NULL,
  MODIFY COLUMN last_ping_at TIMESTAMP NULL;
