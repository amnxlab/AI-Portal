# Deploying the RFID / attendance unification

Everything is built and verified. This is the one step that changes
production, which is why it is written down rather than already done.

## What is already true

- `aiserver-backend:latest` and the frontend bundle in `frontend/build/` are
  built from the current source. Both compile clean (`nest build`, `tsc -b`).
- Migration **024_rfid_unification** was applied to a throwaway copy of the
  live database, twice, with zero errors — it is idempotent.
- The new backend was booted against a throwaway copy of the live database.
  Nest started, the migration ran, all RFID routes mapped, and
  `/api/rfid/device/poll` correctly answered `401` without reader credentials.
- Production was left untouched: `aiserver_db` still has no `rfid_*` tables.
- A pre-migration dump is in `backups/pre-rfid-024-<timestamp>.sql`.

## What the deploy will do

1. Apply migration 024: adds `rfid_devices`, `rfid_cards`,
   `rfid_registration_sessions`, `rfid_event_log`, `attendance_sessions`,
   `attendance_corrections`, `system_settings`; adds remote-work columns to
   `users`; adds provenance columns to `attendance_records`.
2. **Change `attendance_records.user_id` to `ON DELETE RESTRICT`.** Deleting
   an employee who has attendance will now be refused with an explanation
   rather than silently erasing their history. Deactivation is the route.
3. **Backfill working sessions from existing attendance records.** On the
   rehearsal this turned 32 existing records into 16 closed sessions. It is
   derived data — it reads `attendance_records` and writes
   `attendance_sessions`, and the originals are not modified.
4. Serve the new frontend: the header work timer, the rebuilt Attendance
   module, the RFID section in each employee's profile, and the
   attendance-derived cap on weekly reports.

Reports are **not** capped by attendance until an enforcement week is set
(Attendance → Overview → Enforcement). Until then hours are recorded and
shown but nothing is refused, so switching this on does not invalidate past
reports.

## The commands

```bash
cd /opt/aiserver

# Optional but cheap — a second dump immediately before the change
docker exec aiserver_postgres pg_dump -U aiserver -d aiserver_db \
  > "backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql"

# Backend: applies the migration on startup, then serves the new API
docker compose up -d backend

# Frontend: image only packages the already-built bundle
docker compose build frontend && docker compose up -d frontend
```

Then check:

```bash
docker logs --tail 40 aiserver_backend | grep -E "migrations|successfully started"
curl -k -o /dev/null -w '%{http_code}\n' https://portal.lan/api/rfid/device/poll   # expect 401
```

`[migrations] applied 024_rfid_unification` and
`Nest application successfully started` are the two lines that matter. The
`401` confirms the reader endpoint is live and refusing unauthenticated
callers.

## If it goes wrong

```bash
cd /opt/aiserver
docker compose stop backend
docker exec -i aiserver_postgres psql -U aiserver -d postgres \
  -c "DROP DATABASE aiserver_db;" -c "CREATE DATABASE aiserver_db;"
docker exec -i aiserver_postgres psql -U aiserver -d aiserver_db \
  < backups/pre-rfid-024-<timestamp>.sql
git -C /opt/aiserver stash          # if the source needs reverting too
docker compose up -d backend
```

The migration is additive apart from the two foreign-key changes, so in
practice a forward fix is usually easier than a restore.

## First steps after deploying

1. **Attendance → Readers → Add reader.** Device ID `RFID-SM2-001` to match
   the firmware. Copy the API key — it is shown once.
2. Put that key into `firmware/include/config.h` as `PORTAL_API_KEY`.
3. Give each employee an **Employee ID** if they do not have one. Card
   registration is refused without it, and the employee list shows which
   accounts are missing one.
4. Leave report enforcement off until the reader has been recording real
   attendance for a full week, then set the enforcement week.

## Still outstanding on the network

Neither blocks the deploy, but both will bite later:

- `eno1` holds **192.168.1.10 on a DHCP lease, not a static address**. The
  reader's pinned DNS address and every client's resolver point at it.
- The router's DHCP still advertises **192.168.1.99** as DNS — the
  pre-migration address, which no longer answers. Every client on this LAN
  waits for it to time out on each lookup. The reader works around it by
  asking 192.168.1.10 directly.
