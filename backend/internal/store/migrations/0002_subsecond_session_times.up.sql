-- Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
-- Licensed under the Apache License, Version 2.0.
--
-- Gives the two session timestamps that are *computed with* rather than merely
-- displayed millisecond precision.
--
-- A bare TIMESTAMP has no fractional seconds, and MySQL **rounds** to the
-- nearest second on write: 02:00:10.600 comes back as 02:00:11, four tenths of
-- a second in the future.
--
-- last_ping_at: the anti-teleport guard divides the distance since the last fix
-- by the time since it. Rounding broke that in both directions — a rounded-up
-- stamp made the elapsed time negative, which the guard reads as "the clock
-- moved backwards, do not accuse the crew" and *accepts any jump at all*, while
-- a rounded-down one shrank a legitimate gap into an impossible speed and threw
-- a real fix away.
--
-- finished_at: the leaderboard breaks a tie on score by earliest finish, so two
-- crews arriving 300 ms apart were rounded into a dead heat.
--
-- The wire format is unaffected: every response formats times with
-- time.RFC3339, which is second-resolution either way.

ALTER TABLE team_session
  MODIFY COLUMN finished_at  TIMESTAMP(3) NULL,
  MODIFY COLUMN last_ping_at TIMESTAMP(3) NULL;
