-- Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
-- Licensed under the Apache License, Version 2.0.
--
-- Initial WSO2 Motor Rally schema. Every table from the design spec is created
-- here in one migration so no later milestone has to rework it.
--
-- Conventions: ids are 32-char lowercase hex (store.NewID), columns are
-- snake_case, enum string values are snake_case.

CREATE TABLE event (
  id             CHAR(32)     NOT NULL PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  event_date     DATE         NOT NULL,
  -- Local wall-clock start, "HH:MM". The 09:00 sync broadcast fires from it.
  start_time     VARCHAR(8)   NOT NULL,
  status         ENUM('setup','active','complete') NOT NULL DEFAULT 'setup',
  start_label    VARCHAR(200) NULL,
  start_lat      DOUBLE       NULL,
  start_lng      DOUBLE       NULL,
  start_radius_m INT          NOT NULL DEFAULT 40,
  end_label      VARCHAR(200) NULL,
  end_lat        DOUBLE       NULL,
  end_lng        DOUBLE       NULL,
  end_radius_m   INT          NOT NULL DEFAULT 30,
  -- Cipher revealed to every crew on the start signal.
  cipher         VARCHAR(200) NULL,
  created_by     VARCHAR(120) NOT NULL,
  created_on     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_event_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE route (
  id            CHAR(32)     NOT NULL PRIMARY KEY,
  event_id      CHAR(32)     NOT NULL,
  name          VARCHAR(120) NOT NULL,
  display_order INT          NOT NULL DEFAULT 0,
  -- CSV import resolves a vehicle's route by name within its event.
  UNIQUE KEY uq_route_name (event_id, name),
  CONSTRAINT fk_route_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE waypoint (
  id                CHAR(32)     NOT NULL PRIMARY KEY,
  route_id          CHAR(32)     NOT NULL,
  display_order     INT          NOT NULL DEFAULT 0,
  label             VARCHAR(200) NOT NULL,
  lat               DOUBLE       NOT NULL,
  lng               DOUBLE       NOT NULL,
  boundary_radius_m INT          NOT NULL DEFAULT 50,
  KEY idx_waypoint_route_order (route_id, display_order),
  CONSTRAINT fk_waypoint_route FOREIGN KEY (route_id) REFERENCES route (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE task (
  id       CHAR(32)     NOT NULL PRIMARY KEY,
  event_id CHAR(32)     NOT NULL,
  code     VARCHAR(8)   NOT NULL,
  title    VARCHAR(200) NOT NULL,
  -- taskengine.TaskType, e.g. INPUT_SELECT. Validated in the service layer.
  type     VARCHAR(40)  NOT NULL,
  -- `trigger` is a MySQL reserved word, hence the backticks here and in every
  -- query that touches it.
  `trigger` VARCHAR(20) NOT NULL,
  points   INT          NOT NULL DEFAULT 0,
  sensor   VARCHAR(20)  NOT NULL DEFAULT 'none',
  -- Per-type parameters: cipher options, arithmetic operands, grid solution…
  config   JSON         NOT NULL,
  UNIQUE KEY uq_task_code (event_id, code),
  CONSTRAINT fk_task_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE waypoint_task (
  waypoint_id   CHAR(32) NOT NULL,
  task_id       CHAR(32) NOT NULL,
  display_order INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (waypoint_id, task_id),
  KEY idx_waypoint_task_task (task_id),
  CONSTRAINT fk_waypoint_task_waypoint FOREIGN KEY (waypoint_id) REFERENCES waypoint (id) ON DELETE CASCADE,
  CONSTRAINT fk_waypoint_task_task FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vehicle (
  id             CHAR(32)     NOT NULL PRIMARY KEY,
  event_id       CHAR(32)     NOT NULL,
  code           VARCHAR(20)  NOT NULL,
  team_name      VARCHAR(200) NOT NULL,
  vehicle_type   VARCHAR(40)  NULL,
  contact_number VARCHAR(40)  NULL,
  route_id       CHAR(32)     NULL,
  status         ENUM('ok','breakdown','device_issue') NOT NULL DEFAULT 'ok',
  UNIQUE KEY uq_vehicle_code (event_id, code),
  KEY idx_vehicle_route (route_id),
  CONSTRAINT fk_vehicle_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
  -- Clearing a route leaves its vehicles unassigned rather than deleting them.
  CONSTRAINT fk_vehicle_route FOREIGN KEY (route_id) REFERENCES route (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE crew_member (
  id             CHAR(32)     NOT NULL PRIMARY KEY,
  vehicle_id     CHAR(32)     NOT NULL,
  name           VARCHAR(200) NOT NULL,
  -- A member joins their car's session by typing the last four digits of this
  -- number. Stored whole so the roster stays useful to organizers, but never
  -- returned to a phone: only the last four are ever compared, server-side.
  --
  -- The address the super app authenticates this member by. The in-car app is
  -- embedded in the WSO2 Open Super App, so a joining phone presents an
  -- Asgardeo token and POST /sessions/join matches its email claim against
  -- this. NOT NULL with no DEFAULT on purpose: a member without one could
  -- never join, so strict mode rejecting the INSERT is better than seeding a
  -- roster that looks provisioned and strands someone at the start line.
  -- Unique per vehicle, not globally — one person may appear on two events'
  -- rosters, but never twice in the same car, or a join could not tell which
  -- row is calling.
  email          VARCHAR(320) NOT NULL,
  -- Required too, but only so an organizer can call a car that goes quiet. It
  -- stopped being a credential when the super app took over identity.
  phone_number   VARCHAR(40)  NOT NULL,
  -- Roster metadata: who is expected to navigate. It confers nothing at run
  -- time — every member's phone has the same powers once joined.
  role           ENUM('navigator','node') NOT NULL DEFAULT 'node',
  origin_country VARCHAR(80)  NULL,
  UNIQUE KEY uq_crew_member_email (vehicle_id, email),
  KEY idx_crew_vehicle (vehicle_id),
  CONSTRAINT fk_crew_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicle (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE team_session (
  id                  CHAR(32)  NOT NULL PRIMARY KEY,
  event_id            CHAR(32)  NOT NULL,
  vehicle_id          CHAR(32)  NOT NULL,
  bound_at            TIMESTAMP NULL,
  started_at          TIMESTAMP NULL,
  -- TIMESTAMP(3), not TIMESTAMP: the leaderboard breaks a tie on score by
  -- earliest finish, and a bare TIMESTAMP has no fractional seconds and
  -- *rounds* on write — two crews arriving 300 ms apart would be stored as a
  -- dead heat.
  finished_at         TIMESTAMP(3) NULL,
  current_waypoint_id CHAR(32)  NULL,
  total_score         INT       NOT NULL DEFAULT 0,
  status              ENUM('bound','active','finished') NOT NULL DEFAULT 'bound',
  -- Last reported position, kept for the organizer live monitor (A6).
  last_lat            DOUBLE    NULL,
  last_lng            DOUBLE    NULL,
  -- TIMESTAMP(3) for the same reason as finished_at, and here it is worse than
  -- a cosmetic loss: the anti-teleport check divides the distance since the
  -- last fix by the time since it. Rounding can put this value up to half a
  -- second in the *future*, making the elapsed time negative — which the guard
  -- reads as a backwards clock and waves the jump through.
  last_ping_at        TIMESTAMP(3) NULL,
  -- One live session per vehicle: 1 while the session is live, NULL once it is
  -- finished. MySQL treats NULLs as distinct in a unique index, so a vehicle
  -- can hold at most one bound-or-active session while still accumulating any
  -- number of finished ones.
  --
  -- This is no longer a "one active phone" gate. Every phone in the car shares
  -- this one session (see session_device), and the index is what makes that
  -- true: the first member to join creates the row, and the rest collide with
  -- it and join what they find, so a crew cannot end up split across two runs.
  active_flag         TINYINT GENERATED ALWAYS AS (
                        CASE WHEN status IN ('bound','active') THEN 1 ELSE NULL END
                      ) STORED,
  UNIQUE KEY uq_live_session_per_vehicle (vehicle_id, active_flag),
  KEY idx_session_event_status (event_id, status),
  KEY idx_session_leaderboard (event_id, total_score, finished_at),
  CONSTRAINT fk_session_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
  CONSTRAINT fk_session_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicle (id) ON DELETE CASCADE,
  CONSTRAINT fk_session_waypoint FOREIGN KEY (current_waypoint_id) REFERENCES waypoint (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per phone in the car. The whole crew shares a session; this is what
-- distinguishes the phones inside it, so a handler can tell which one called.
CREATE TABLE session_device (
  id             CHAR(32)  NOT NULL PRIMARY KEY,
  session_id     CHAR(32)  NOT NULL,
  crew_member_id CHAR(32)  NOT NULL,
  joined_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Last time this phone was heard from. "Who is sharing location" is derived
  -- from this rather than stored as a role: whichever phones reported recently
  -- are the ones covering the car. There is no designated provider to elect,
  -- hand over, or get stuck, and a phone that goes quiet simply stops counting.
  last_seen_at   TIMESTAMP NULL,
  -- One phone per member, so a rebooted or borrowed phone re-joins onto the row
  -- it already had instead of becoming a fifth device.
  UNIQUE KEY uq_device_per_member (session_id, crew_member_id),
  KEY idx_device_seen (session_id, last_seen_at),
  CONSTRAINT fk_device_session FOREIGN KEY (session_id) REFERENCES team_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_device_crew FOREIGN KEY (crew_member_id) REFERENCES crew_member (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which boundaries a car has already entered.
--
-- Geofence events must be edge-triggered: a crew parked inside a waypoint pings
-- every few seconds, and re-firing the unlock each time would restart a trivia
-- timer on every ping. Inserting here is the edge — the insert either claims the
-- crossing or reports it was already claimed, atomically, with no in-memory
-- state to keep and nothing to get out of step across replicas.
--
-- Claim it with ON DUPLICATE KEY UPDATE session_id = session_id, NOT with
-- INSERT IGNORE. Both report zero affected rows for a repeat ping, but IGNORE
-- also downgrades a foreign-key violation to a warning and returns zero — so a
-- waypoint id that does not exist would read as "already visited" and silently
-- swallow the unlock. ON DUPLICATE KEY raises 1452 for that instead.
CREATE TABLE session_waypoint_visit (
  session_id       CHAR(32)  NOT NULL,
  waypoint_id      CHAR(32)  NOT NULL,
  first_entered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, waypoint_id),
  CONSTRAINT fk_visit_session FOREIGN KEY (session_id) REFERENCES team_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_visit_waypoint FOREIGN KEY (waypoint_id) REFERENCES waypoint (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE task_submission (
  id             CHAR(32)  NOT NULL PRIMARY KEY,
  session_id     CHAR(32)  NOT NULL,
  task_id        CHAR(32)  NOT NULL,
  waypoint_id    CHAR(32)  NULL,
  status         ENUM('pending','completed','skipped') NOT NULL DEFAULT 'pending',
  payload        JSON      NULL,
  awarded_points INT       NOT NULL DEFAULT 0,
  submitted_at   TIMESTAMP NULL,
  -- The crew member whose phone won this task.
  --
  -- ON DELETE SET NULL, not CASCADE: updating a vehicle replaces its crew rows
  -- wholesale, and a re-typed roster must never delete the score the car
  -- earned. Losing the attribution is acceptable; losing the points is not.
  crew_member_id CHAR(32)  NULL,
  -- First answer wins for the vehicle. Every phone in the car races for this
  -- key, so the index is the arbiter: the winner's INSERT succeeds and a
  -- latecomer's fails, rather than overwriting a score that was already earned.
  -- The row is never updated once claimed.
  UNIQUE KEY uq_submission_session_task (session_id, task_id),
  KEY idx_submission_task (task_id),
  KEY idx_submission_crew (crew_member_id),
  CONSTRAINT fk_submission_session FOREIGN KEY (session_id) REFERENCES team_session (id) ON DELETE CASCADE,
  CONSTRAINT fk_submission_task FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE,
  CONSTRAINT fk_submission_crew FOREIGN KEY (crew_member_id) REFERENCES crew_member (id) ON DELETE SET NULL,
  CONSTRAINT fk_submission_waypoint FOREIGN KEY (waypoint_id) REFERENCES waypoint (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vehicle_alert (
  id          CHAR(32)  NOT NULL PRIMARY KEY,
  vehicle_id  CHAR(32)  NOT NULL,
  type        ENUM('breakdown','device_issue','other') NOT NULL,
  note        TEXT      NULL,
  source      ENUM('organizer','crew') NOT NULL DEFAULT 'organizer',
  raised_by   VARCHAR(120) NULL,
  lat         DOUBLE    NULL,
  lng         DOUBLE    NULL,
  raised_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  -- The dashboard's open-alerts card filters on resolved_at IS NULL.
  KEY idx_alert_vehicle_open (vehicle_id, resolved_at),
  CONSTRAINT fk_alert_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicle (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE voucher (
  id           CHAR(32)    NOT NULL PRIMARY KEY,
  session_id   CHAR(32)    NOT NULL,
  entry_code   VARCHAR(40) NULL,
  locker_id    VARCHAR(40) NULL,
  lunch_passes INT         NOT NULL DEFAULT 0,
  UNIQUE KEY uq_voucher_session (session_id),
  CONSTRAINT fk_voucher_session FOREIGN KEY (session_id) REFERENCES team_session (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE debrief_video (
  id          CHAR(32)     NOT NULL PRIMARY KEY,
  event_id    CHAR(32)     NOT NULL,
  vehicle_id  CHAR(32)     NULL,
  day         INT          NOT NULL DEFAULT 1,
  object_key  VARCHAR(400) NOT NULL,
  uploaded_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_debrief_event_day (event_id, day),
  CONSTRAINT fk_debrief_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
  CONSTRAINT fk_debrief_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicle (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
