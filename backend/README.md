## AI-Server Backend (NestJS)

This directory contains the **NestJS backend** for AI-Server — a unified lab management platform that powers authentication, RBAC, scheduling, inventory, projects, tasks, wishlists, reports, real-time dashboards, and Discord integrations.

For an end-to-end overview of the entire system (frontend + backend + deployment), see the root `README.md`.

---

## Tech Stack

- NestJS 11 (TypeScript)
- TypeORM + PostgreSQL
- Passport.js + JWT + bcrypt
- Socket.io (via `@nestjs/websockets` and `@nestjs/platform-socket.io`)
- Multer for file uploads
- `pdf-lib` for PDF generation
- `@nestjs/throttler` for rate limiting

---

## Local Development

From the `backend/` directory:

```bash
npm install
```

Set the required environment variables (either via root `.env` or a local `.env` if you run without Docker):

- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `FRONTEND_URL` (for CORS)
- Optional: `DISCORD_WEBHOOK_TASKS`, `DISCORD_WEBHOOK_SCHEDULE`, `DISCORD_WEBHOOK_REPORTS`, `DOCUMENTS_PATH`

Start the server in development mode:

```bash
npm run start:dev
```

This will start the API at `http://localhost:4000/api` by default.

---

## Key Modules

The main application module (`src/app.module.ts`) wires together feature modules:

- `AuthModule` — login, JWT access/refresh, password reset, rate-limited endpoints.
- `UsersModule` & `RolesModule` — user CRUD and role/permission management.
- `SchedulesModule` — weekly schedules and optional Discord posting.
- `InventoryModule` — inventory items, check-in/out logs, uploads.
- `ProjectsModule` & `TasksModule` — projects, sub-projects, Kanban tasks, attachments.
- `WishlistsModule` — wishlist items and budget summaries.
- `ReportsModule` — weekly reports and PDF export.
- `DashboardModule` — summary metrics, activity feeds, Gantt data.
- `RealtimeModule` — Socket.io gateway for real-time updates.
- `DiscordModule` — shared Discord webhook service.
- `AuditModule` — audit log writer.
- `UploadsModule` & `FilesModule` — file upload and retrieval.

Configuration is handled centrally via `ConfigModule` and `TypeOrmModule.forRootAsync`, with sensible defaults for local development and stricter settings for production (e.g., SSL when `NODE_ENV=production`).

---

## Testing

Run backend tests from `backend/`:

```bash
npm run test       # unit tests
npm run test:e2e   # end-to-end tests
npm run test:cov   # coverage report
```

Ensure a test database is available and configured (e.g., via a separate `.env.test`) before running E2E tests.

