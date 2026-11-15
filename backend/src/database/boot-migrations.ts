import { Client } from 'pg';

/**
 * Boot-time schema migrations.
 *
 * TypeORM `synchronize` is off and the project has no migration runner — the
 * numbered .sql files in ./migrations were applied by hand. From 024 onward
 * migrations live here and run automatically, once each, before the Nest
 * application starts (so every module's entities match the database by the
 * time they are first queried). Each migration runs in its own transaction
 * and is recorded in `schema_migrations`.
 */
interface Migration { id: string; sql: string }

const MIGRATIONS: Migration[] = [
    {
        id: '024_rfid_unification',
        sql: `
        -- ── Remote-work policy (per employee, admin controlled) ─────────────
        ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_work_allowed BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_work_percent NUMERIC(5,2) NOT NULL DEFAULT 20;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_max_hours   NUMERIC(5,1);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS online_clock_enabled BOOLEAN NOT NULL DEFAULT false;
        -- Carry over: the accounts that could already clock in through the
        -- portal are the ones authorised for remote work.
        UPDATE users SET remote_work_allowed = true WHERE online_clock_enabled = true;

        -- ── RFID readers ────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS rfid_devices (
            id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            device_id        VARCHAR(64)  NOT NULL UNIQUE,
            name             VARCHAR(120) NOT NULL,
            location         VARCHAR(200),
            api_key_hash     VARCHAR(64)  NOT NULL,
            is_active        BOOLEAN      NOT NULL DEFAULT true,
            firmware_version VARCHAR(32),
            ip_address       VARCHAR(64),
            last_seen_at     TIMESTAMPTZ,
            last_scan_at     TIMESTAMPTZ,
            created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- ── RFID cards ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS rfid_cards (
            id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id              UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            uid                  VARCHAR(32) NOT NULL,
            status               TEXT NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'replaced', 'removed')),
            assigned_by          UUID REFERENCES users(id) ON DELETE SET NULL,
            assigned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            registered_device_id UUID REFERENCES rfid_devices(id) ON DELETE SET NULL,
            revoked_by           UUID REFERENCES users(id) ON DELETE SET NULL,
            revoked_at           TIMESTAMPTZ,
            revoke_reason        TEXT
        );
        -- A card belongs to at most one employee, and an employee has at most
        -- one live card. Enforced by the database, not just application code.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_cards_active_uid  ON rfid_cards(uid)     WHERE status = 'active';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_cards_active_user ON rfid_cards(user_id) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_rfid_cards_user ON rfid_cards(user_id);

        -- ── Card registration sessions ──────────────────────────────────────
        CREATE TABLE IF NOT EXISTS rfid_registration_sessions (
            id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id      UUID NOT NULL REFERENCES rfid_devices(id) ON DELETE CASCADE,
            initiated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
            mode           TEXT NOT NULL DEFAULT 'register' CHECK (mode IN ('register', 'replace')),
            status         TEXT NOT NULL DEFAULT 'waiting'
                           CHECK (status IN ('waiting', 'success', 'failed', 'expired', 'cancelled')),
            card_uid       VARCHAR(32),
            card_id        UUID REFERENCES rfid_cards(id) ON DELETE SET NULL,
            failure_reason TEXT,
            expires_at     TIMESTAMPTZ NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at   TIMESTAMPTZ
        );
        -- One reader can only be waiting for one employee's card at a time.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_reg_waiting_device
            ON rfid_registration_sessions(device_id) WHERE status = 'waiting';
        CREATE INDEX IF NOT EXISTS idx_rfid_reg_user ON rfid_registration_sessions(user_id, created_at DESC);

        -- ── Reader request log (every scan and its outcome) ─────────────────
        CREATE TABLE IF NOT EXISTS rfid_event_log (
            id          BIGSERIAL PRIMARY KEY,
            event_id    UUID,
            device_id   UUID REFERENCES rfid_devices(id) ON DELETE SET NULL,
            device_code VARCHAR(64),
            kind        TEXT NOT NULL,
            uid         VARCHAR(32),
            user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
            result      TEXT NOT NULL,
            detail      TEXT,
            response    JSONB,
            ip_address  VARCHAR(64),
            device_time TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        -- Idempotency: a retried event returns the response stored here.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_event_device_event
            ON rfid_event_log(device_id, event_id) WHERE event_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_rfid_event_created ON rfid_event_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_rfid_event_user    ON rfid_event_log(user_id, created_at DESC);

        -- ── Attendance events: new sources + provenance ─────────────────────
        ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_source_check;
        ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_source_check
            CHECK (source IN ('manual', 'csv_import', 'online_portal', 'rfid', 'admin_correction'));
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS device_id  UUID REFERENCES rfid_devices(id) ON DELETE SET NULL;
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS card_id    UUID REFERENCES rfid_cards(id)   ON DELETE SET NULL;
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS event_id   UUID;
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
        -- Deleting a user must never erase attendance history.
        ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_user_id_fkey;
        ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

        -- ── Working sessions ────────────────────────────────────────────────
        -- original_* never change after creation. clock_in_at / clock_out_at
        -- are the effective values (they move only through an audited
        -- correction recorded in attendance_corrections).
        CREATE TABLE IF NOT EXISTS attendance_sessions (
            id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            mode                TEXT NOT NULL CHECK (mode IN ('onsite', 'remote')),
            source              TEXT NOT NULL,
            clock_in_record_id  UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
            clock_out_record_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
            original_in_at      TIMESTAMPTZ,
            original_out_at     TIMESTAMPTZ,
            clock_in_at         TIMESTAMPTZ NOT NULL,
            clock_out_at        TIMESTAMPTZ,
            status              TEXT NOT NULL CHECK (status IN ('open', 'closed', 'incomplete', 'voided')),
            corrected           BOOLEAN NOT NULL DEFAULT false,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
        );
        -- An employee has at most one open session: this is what makes two
        -- simultaneous scans unable to both register as a clock-in.
        CREATE UNIQUE INDEX IF NOT EXISTS uq_att_session_open_user
            ON attendance_sessions(user_id) WHERE status = 'open';
        CREATE INDEX IF NOT EXISTS idx_att_session_user_in ON attendance_sessions(user_id, clock_in_at);
        CREATE INDEX IF NOT EXISTS idx_att_session_in      ON attendance_sessions(clock_in_at);

        -- ── Administrative corrections (append-only) ────────────────────────
        CREATE TABLE IF NOT EXISTS attendance_corrections (
            id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            session_id        UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE RESTRICT,
            user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            action            TEXT NOT NULL CHECK (action IN ('create', 'edit', 'close', 'void', 'manual_clock')),
            old_values        JSONB,
            new_values        JSONB,
            reason            TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
            corrected_by      UUID REFERENCES users(id) ON DELETE SET NULL,
            corrected_by_name TEXT NOT NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_att_corr_session ON attendance_corrections(session_id);
        CREATE INDEX IF NOT EXISTS idx_att_corr_created ON attendance_corrections(created_at DESC);

        -- ── Portal-wide settings ────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS system_settings (
            key        TEXT PRIMARY KEY,
            value      JSONB,
            updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        `,
    },
    {
        id: '025_archive_instead_of_delete',
        sql: `
        -- Removing an employee must not remove their work.
        --
        -- A hard delete was destructive in both directions: it erased their
        -- comments, weekly reports, submitted tickets and schedules through
        -- ON DELETE CASCADE, and it was refused outright for anyone with
        -- attendance, a card, or anything they had created. Neither outcome is
        -- what "remove this person from the lab" should mean.
        --
        -- Accounts are archived instead. The row and every reference to it
        -- stay exactly as they were; what is released is the Employee ID, so
        -- it can be issued to somebody new. The original is kept here so
        -- historical attendance can still be explained.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at           TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_employee_id  VARCHAR(64);

        CREATE INDEX IF NOT EXISTS idx_users_archived
            ON users(archived_at) WHERE archived_at IS NOT NULL;
        `,
    },
    {
        id: '026_deleted_user_tombstone',
        sql: `
        -- Deleting a person must not delete their work.
        --
        -- A deleted account becomes a tombstone: the row stays so that every
        -- task, report, upload, schedule and attendance record it is attached
        -- to keeps a valid owner, but the account stops existing in every way
        -- that matters. It cannot sign in, it releases its Employee ID and
        -- username for reuse, and its name is shown as "Name (deleted user)"
        -- wherever it still appears.
        --
        -- The display name is rewritten in place rather than resolved at read
        -- time because the name is read in dozens of endpoints and several raw
        -- SQL joins; changing it at the source makes every one of them correct
        -- at once and cannot be forgotten in a new query. The originals are
        -- kept here so the change is reversible.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS original_full_name VARCHAR(255);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS original_username  VARCHAR(255);
        `,
    },
    {
        id: '027_invite_registration',
        sql: `
        -- An administrator creates an account from an email address alone,
        -- and the person it belongs to chooses their own username and
        -- password from a link sent to that address.
        --
        -- This removes the step where an administrator typed a password and
        -- then had to get it to the new member somehow: nobody but the
        -- account holder ever knows it, and there is no shared secret in a
        -- chat message or on a sticky note to go stale.
        --
        -- An invited account exists from the moment it is created, so it can
        -- be given an Employee ID, a position and permissions straight away,
        -- but it is NOT active: is_active stays false until registration is
        -- completed, which is what stops it being signed in to. invited_at
        -- distinguishes that from an account an administrator deactivated,
        -- which is the same is_active = false.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at   TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;

        -- Everyone who already has a working account registered long ago; the
        -- exact moment is not recoverable, so their creation date stands in.
        -- Without this they would look like outstanding invitations.
        UPDATE users SET registered_at = created_at
         WHERE registered_at IS NULL AND invited_at IS NULL;

        CREATE TABLE IF NOT EXISTS registration_tokens (
            id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(128) NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at    TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        -- Only the hash is stored, exactly as for password-reset tokens: a
        -- leaked database still cannot be used to claim somebody's account.
        CREATE INDEX IF NOT EXISTS idx_registration_tokens_user ON registration_tokens(user_id);
        `,
    },
    {
        id: '028_project_archive',
        sql: `
        -- Archiving a project is not cancelling it and not deleting it.
        --
        -- A finished project still owns its expenses, labor, tasks and
        -- history, and all of that has to stay exactly where it is. What
        -- archiving changes is only whether the project is in the way: it
        -- drops out of the active list and lives in the archive, from where
        -- it can be opened, read in full, and restored.
        --
        -- This is deliberately a separate column from \`status\` rather than
        -- another status value. Status says what became of the work
        -- (Active, On Hold, Planned, Completed, Cancelled); archiving says
        -- whether the project is still on the desk. A cancelled project can
        -- be archived, and so can a completed one, without either losing
        -- what it was.
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ;
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects(archived_at);
        `,
    },
    {
        id: '029_budget_years',
        sql: `
        -- The budget runs in years, and closing one must never cost anything.
        --
        -- Every account belongs to exactly one budget year. Everything else
        -- hangs off an account — allocations belong to accounts, expenses to
        -- allocations, labor deductions to accounts — so a year's figures are
        -- DERIVED by walking those links, never copied. That is what makes
        -- "archive the year" cost nothing and lose nothing: no row moves, no
        -- total is snapshotted, and the same query that reports this year
        -- reports any past year. A snapshot would have been a second source
        -- of truth, and the first time it disagreed with the ledger nobody
        -- would know which to believe.
        CREATE TABLE IF NOT EXISTS budget_years (
            id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            year         INTEGER NOT NULL,
            label        VARCHAR(64) NOT NULL,
            status       TEXT NOT NULL DEFAULT 'active',
            opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            closed_at    TIMESTAMPTZ,
            closed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
            notes        TEXT,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT budget_years_status_check CHECK (status IN ('active', 'archived'))
        );

        -- A year can exist once, and only one of them is open at a time. Both
        -- are enforced here rather than only in the service, because "start a
        -- new year" is exactly the button somebody double-clicks.
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_budget_year_number ON budget_years(year);
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_budget_year_active
            ON budget_years((status)) WHERE status = 'active';

        ALTER TABLE budget_accounts
            ADD COLUMN IF NOT EXISTS budget_year_id UUID REFERENCES budget_years(id) ON DELETE RESTRICT;
        CREATE INDEX IF NOT EXISTS idx_budget_accounts_year ON budget_accounts(budget_year_id);

        -- Everything that exists today becomes the first year, taken from the
        -- earliest account on record so the label matches what the accounts
        -- are actually called.
        INSERT INTO budget_years (year, label, status)
        SELECT y, y || ' Budget', 'active'
        FROM (
            SELECT COALESCE(
                (SELECT EXTRACT(YEAR FROM MIN(created_at))::int FROM budget_accounts),
                EXTRACT(YEAR FROM now())::int
            ) AS y
        ) s
        WHERE NOT EXISTS (SELECT 1 FROM budget_years);

        UPDATE budget_accounts
           SET budget_year_id = (SELECT id FROM budget_years ORDER BY year LIMIT 1)
         WHERE budget_year_id IS NULL;
        `,
    },
    {
        id: '030_funding_source_year',
        sql: `
        -- A funding source belongs to the year it was raised in, and most of
        -- them end with it: a one-off grant has no business appearing in next
        -- year's list, where it would invite an account to be funded from
        -- money that is already spent.
        --
        -- Some genuinely do span years — a multi-year award is still the same
        -- award — so they carry a flag saying so. A source is offered in a
        -- year when it belongs to that year, or when it carries over from an
        -- earlier one. The flag is set by whoever records the source, because
        -- nothing in the data can tell the two apart.
        ALTER TABLE funding_sources
            ADD COLUMN IF NOT EXISTS budget_year_id UUID REFERENCES budget_years(id) ON DELETE SET NULL;
        ALTER TABLE funding_sources
            ADD COLUMN IF NOT EXISTS carries_over BOOLEAN NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS idx_funding_sources_year ON funding_sources(budget_year_id);

        -- Everything that exists today predates budget years, so it belongs to
        -- the first one. Nothing is assumed to carry over: a source that
        -- should span years is flagged deliberately, rather than every old
        -- source silently following the lab into every future year.
        UPDATE funding_sources
           SET budget_year_id = (SELECT id FROM budget_years ORDER BY year LIMIT 1)
         WHERE budget_year_id IS NULL;
        `,
    },
    {
        id: '031_shifts',
        sql: `
        -- Shifts: when somebody is expected, so attendance can say more than
        -- "they clocked in at some point".
        --
        -- Until now attendance recorded what happened and nothing about what
        -- was supposed to happen, which is why there was no way to show who
        -- is late, who is missing, or whether a day was covered. A shift is a
        -- recurring window (days of the week plus a start and end time); an
        -- assignment puts a person on one for a date range.
        --
        -- Times are stored as local wall-clock TIME, not timestamps: "the
        -- morning shift starts at 09:00" stays true across daylight saving,
        -- which an absolute time would not.
        CREATE TABLE IF NOT EXISTS shifts (
            id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name          VARCHAR(100) NOT NULL,
            start_time    TIME NOT NULL,
            end_time      TIME NOT NULL,
            -- ISO weekday: 1 = Monday … 7 = Sunday, matching isoWeekday() in
            -- common/tz.ts. The codebase already has one weekday convention
            -- and a second one would be a standing source of off-by-one.
            days_of_week  SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
            -- How late someone may clock in before the day counts as late.
            grace_minutes SMALLINT NOT NULL DEFAULT 10,
            is_active     BOOLEAN NOT NULL DEFAULT true,
            notes         TEXT,
            created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT shifts_grace_check CHECK (grace_minutes >= 0 AND grace_minutes <= 240)
        );

        -- A person's time on a shift. Open-ended until end_date is set, so
        -- history is kept rather than overwritten when a rota changes: last
        -- month's lateness is still judged against the shift that applied
        -- then.
        CREATE TABLE IF NOT EXISTS shift_assignments (
            id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            shift_id   UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            start_date DATE NOT NULL,
            end_date   DATE,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT shift_assignments_range_check CHECK (end_date IS NULL OR end_date >= start_date)
        );
        CREATE INDEX IF NOT EXISTS idx_shift_assignments_user ON shift_assignments(user_id, start_date);
        CREATE INDEX IF NOT EXISTS idx_shift_assignments_shift ON shift_assignments(shift_id);
        `,
    },
    {
        id: '032_project_budget_no_default',
        sql: `
        -- "No budget" and "a budget of zero" are different things, and the
        -- column default collapsed them.
        --
        -- projects.budget carried DEFAULT 0, so every project ever created got
        -- a budget of $0 whether or not anyone entered one — which is why the
        -- field always came back pre-filled with zero. Dropping the default
        -- lets the column mean what it says: NULL is "nobody set a budget".
        ALTER TABLE projects ALTER COLUMN budget DROP DEFAULT;

        -- The zeros already on the table were put there by that default, not
        -- by a person: the budget field has only ever been able to send a
        -- number, and every screen already treats 0 as "no budget" by hiding
        -- it. Clearing them makes the stored data agree with what is shown,
        -- and with what the edit form will now display. A real figure is
        -- untouched — only exact zeros are cleared.
        UPDATE projects SET budget = NULL WHERE budget = 0;
        `,
    },
    {
        id: '033_task_email_notifications',
        sql: `
        -- The record of who was emailed about which task, and when.
        --
        -- Two jobs. It stops a double-click, a re-submitted form or an
        -- impatient second press from sending the same person the same
        -- assignment twice: a send is refused while a recent row exists for
        -- that task and recipient. And it leaves an audit trail, because
        -- "was this person actually told?" is otherwise unanswerable once
        -- the toast has gone.
        --
        -- Delivery is recorded as it happened: a row with delivered = false
        -- carries the SMTP error, so a bad address shows up here rather than
        -- only in the log.
        CREATE TABLE IF NOT EXISTS task_email_notifications (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
            recipient_email varchar,
            actor_id        uuid REFERENCES users(id) ON DELETE SET NULL,
            delivered       boolean NOT NULL DEFAULT false,
            error           text,
            sent_at         timestamptz NOT NULL DEFAULT now()
        );

        -- The cooldown lookup: most recent row for a task and recipient.
        CREATE INDEX IF NOT EXISTS task_email_notifications_lookup
            ON task_email_notifications (task_id, user_id, sent_at DESC);
        `,
    },
];

export async function runBootMigrations(): Promise<void> {
    const client = new Client({
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        user: process.env.POSTGRES_USER ?? 'aiserver',
        password: process.env.POSTGRES_PASSWORD ?? 'changeme',
        database: process.env.POSTGRES_DB ?? 'aiserver_db',
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    await client.connect();
    try {
        await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id         TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
        // Serialise concurrent boots (two backend replicas starting together).
        await client.query(`SELECT pg_advisory_lock(724024)`);
        for (const m of MIGRATIONS) {
            const done = await client.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [m.id]);
            if (done.rowCount) continue;
            await client.query('BEGIN');
            try {
                await client.query(m.sql);
                await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [m.id]);
                await client.query('COMMIT');
                console.log(`[migrations] applied ${m.id}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`[migrations] FAILED ${m.id}:`, (err as Error).message);
                throw err;
            }
        }
        await client.query(`SELECT pg_advisory_unlock(724024)`);
    } finally {
        await client.end();
    }
}
