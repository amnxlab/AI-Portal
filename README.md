<p align="center">
  <img src="SUU_Emblem.png" alt="SUU Emblem" height="120">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="AI-ML_Logo.png" alt="AI/ML Lab Logo" height="120">
</p>

<h1 align="center">AI/ML Lab Portal</h1>

<p align="center">
  <strong>One platform. Every lab operation. Zero context switching.</strong>
</p>

<p align="center">
  The command center for Southern Utah University's AI/ML Research Lab —<br/>
  scheduling, projects, tasks, budgets, reports, papers, inventory, attendance, and team coordination<br/>
  in a single, real-time dark-mode interface.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-11-red?logo=nestjs" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" />
  <img src="https://img.shields.io/badge/PostgreSQL-15-316192?logo=postgresql" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" />
  <img src="https://img.shields.io/badge/Socket.io-realtime-black?logo=socket.io" />
</p>

---

## Part of a two-repository system

This portal is one half of the lab's attendance system. The other half is
**[RFID-ShiftMate 2](https://github.com/amnxlab/RFID-ShiftMate-2)** — ESP32 reader firmware that clocks people in and
out with a card.

| | |
|---|---|
| **This repository** | The portal: web app, database, API, and the only place employee and attendance data lives |
| **[RFID-ShiftMate 2](https://github.com/amnxlab/RFID-ShiftMate-2)** | The reader: ESP32 firmware, wiring and enclosure |

They are deliberately separate repositories: they share nothing but an HTTP
API, and have different languages, toolchains and release rhythms. A reader
is reflashed at a bench with a USB cable; the portal is redeployed with
`docker compose`.

**The portal is authoritative.** The reader holds no employee list, no
card-to-person mapping and no attendance history. It reads a card, sends the
UID over HTTPS, and shows whatever the portal answers — so a reader that is
lost gives up nothing, and one that is unplugged loses nothing but the single
unacknowledged tap in its RAM.

The reader-facing API (`/api/rfid/device/*`) is specified in the reader
repository, under `integration/ai_portal_interface/api-specification.md`.

## Why AI/ML Lab Portal?

Research labs drown in fragmented tools — Trello for tasks, Google Sheets for hours, a shared drive for manuals, email threads for approvals. **Lab Portal replaces all of them.**

| Pain point | Lab Portal solution |
|---|---|
| Hours scattered across spreadsheets | ✅ One-click weekly timesheets with PDF export |
| "Who clocked in today?" | ✅ Attendance tracking with clock-in/out, CSV import & daily/weekly reports |
| "Who's in the lab today?" | ✅ Visual shift schedule with Discord auto-post |
| Equipment goes missing | ✅ Inventory catalogue with check-in/out logging |
| Funding requests via email | ✅ Purchase wishlists with approval workflow |
| Reports stuck in inboxes | ✅ Submit → review → approve — all in-app |
| Task status unclear | ✅ Kanban boards with drag-and-drop + time tracking |
| No visibility into projects | ✅ Gantt timelines, budget ledgers, member rosters |

---

## ✨ What's inside

<table>
<tr>
<td width="50%" valign="top">

### � Dashboard
Real-time lab overview with task & project stats, Gantt timeline visualization, team leaderboard, categorized notification alerts, and performance analytics tabs.

### 🗂️ Projects & Tasks
Visual Kanban board with drag-and-drop across Todo / In Progress / Pending Review / Done / Needs Revision, plus calendar and table views. Per-task time tracking, priority filtering, deadline management, and threaded comments.

### 📋 Weekly Reporting
Task-hour timesheets that enforce your lab's weekly hour cap and remote-work policy. Hour cap violations are blocked at submission. PDF export with lab stamp. Discord reminders for stragglers.

### 📅 Scheduling
Weekly shift blocks per person with remote-work tracking. Smart week-ahead prompting defaults to next week on Fridays. Managers see the whole team in one grid. One-click export to image and Discord post.

### 💰 Budget
Nine-tab financial management — funding sources, budget accounts, project allocations, transfers, expenses, labor cost auto-deduction, reports, CSV export, and simulation snapshots for forecasting.

### 🛒 Wishlists
Equipment purchase requests tracked from Requested → Approved → Purchased / Rejected. Budget availability checks at approval time. Supports purchase order generation.

### 🤖 Discord Integration
Five dedicated webhook channels auto-post to Discord — task updates, weekly schedules (with screenshot), report submissions, support tickets, and file/video uploads pending review. Socket.io pushes every change live to all connected browsers.

### 🧠 AI Assistant & JupyterLab
Bundled Open WebUI + Ollama at `:9999` for on-premise LLM chat. Per-user JupyterLab instances with dedicated ports — all tunnelled automatically through the desktop launcher with zero manual setup.

### 🖥️ Desktop Launcher
Cross-platform Python/Tkinter app (`AIPortalLauncher.exe`) that handles VPN-authenticated SSH tunnelling to the shared lab server, auto-starts the portal and JupyterLab, opens the browser when ready, and gives the admin a one-click stop button.

### ⚙️ Settings
Per-user preferences organized into Notifications, Display, and Security sections — notification toggles, date format, timezone, and active session management.

</td>
<td width="50%" valign="top">

### � Attendance
Clock-in / clock-out tracking for every team member. Admins record punches manually or batch-import records via CSV (matching your external time-clock export format). Admin views include per-employee daily shift pairs, weekly and biweekly summaries with hours-vs-cap comparison, and PDF export for payroll. Employees see their own current-week and previous-week hours directly on the Dashboard — no admin needed.

### �📦 Inventory
Asset lifecycle management — CSV import/export, multi-field categories, quantity & condition tracking, location assignment, check-in/out audit log, and low-stock dashboard warnings.

### 📚 Manuals
Document repository with hierarchical folder organization, approval-based publishing workflow, file versioning, and role-based access control.

### 🗄️ Project Files
Project-scoped file storage with nested folder hierarchies, bulk folder uploads, file versioning, and a pending → approved status workflow.

### 🧪 Research Papers
Academic paper catalogue with authors, year, venue, DOI, abstract, tags, and attached files. Folder organization and read-request workflow for access control.

### 🎬 Video Tutorials
Playlist-based learning system — upload training videos and PDFs per project. YouTube-style player with playlist queue, approval workflow, and downloadable resources.

### 🎟️ Support Tickets
Bug reports and access requests with screenshot attachments. Status workflow (Pending → Resolved) with admin resolution notes. No more lost Slack messages.

### 👥 Users & Roles
Full team directory with role assignment, hour caps, remote-work restrictions, avatar support, and job titles. Custom role builder with 12+ permission flags and visual color coding.

### 🔔 Notifications & Profile
Categorized in-app notification hub with read/unread tracking, bulk actions, and entity deep-links. Personal profile management with password change, avatar upload, and settings preferences.

### 🗒️ Audit Log
Immutable record of every action taken on the platform — actor, entity type, action, before/after JSON snapshot, and IP address. Accessible to admins via the API for full accountability.

</td>
</tr>
</table>

---

## 🔔 Stay in the loop — without trying

- **Real-time notification bell** with category tabs, mark-as-read/unread, and deep-link to source
- **Dedicated Notifications page** for full history
- **Browser tab badge** — `(3) Lab Management` — so you never miss an alert
- **5 Discord channels** auto-post tasks, schedules, reports, tickets, and file uploads
- **Socket.io** pushes every change to every connected browser instantly

---

## 🔒 Secure by default

| Layer | Protection |
|---|---|
| Auth | JWT access tokens (15 min) + httpOnly refresh cookie (7 days), auto-rotated |
| Passwords | bcrypt hashing, secure reset with single-use tokens |
| Transport | Helmet headers, CORS restricted to your domain, rate-limited (60 req/min) |
| Access | Role-based guards on every endpoint — 12+ permission flags, fully custom roles |
| Accountability | Full audit trail — actor, entity, action, before/after JSON, IP address |

---

## 🏗️ Built with

<p>
  <img src="https://img.shields.io/badge/-NestJS%2011-E0234E?style=flat-square&logo=nestjs&logoColor=white" />
  <img src="https://img.shields.io/badge/-React%2019-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/-PostgreSQL%2015-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/-Vite%207-646CFF?style=flat-square&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/-Ant%20Design%206-0170FE?style=flat-square&logo=antdesign&logoColor=white" />
  <img src="https://img.shields.io/badge/-Docker-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/-Nginx-009639?style=flat-square&logo=nginx&logoColor=white" />
  <img src="https://img.shields.io/badge/-Socket.io-010101?style=flat-square&logo=socket.io&logoColor=white" />
  <img src="https://img.shields.io/badge/-Zustand%205-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/-Recharts%203-22B5BF?style=flat-square" />
</p>

---

## 🚀 Quick start

```bash
git clone https://github.com/SUU-AI-ML-Lab/AI-Portal.git
cd AI-Portal
cp .env.example .env   # edit with your secrets
./connect.sh            # launches everything — idempotent
```

The portal will be available at **http://localhost:8080**.

<details>
<summary><strong>Production deploy (Docker)</strong></summary>

```bash
cp .env.example .env
# Set strong secrets and correct FRONTEND_URL
docker compose up -d --build
```

| Service | URL |
|---|---|
| Portal | http://your-server:8080 |
| AI Chat (Open WebUI) | http://your-server:9999 |

</details>

---

## 👥 Roles & Permissions

The system ships with four built-in roles — and you can create unlimited custom roles in the UI:

| Role | What they can do |
|---|---|
| **Admin** | Everything — full platform control |
| **Project Leader** | Manage projects & tasks, approve reports, coordinate team |
| **Lab Assistant** | Submit reports, use Kanban, view manuals & papers |
| **Inventory Manager** | Full equipment catalogue access |

Custom roles combine 13+ permission flags: `manage_users`, `manage_budget`, `manage_inventory`, `manage_projects`, `manage_tasks`, `manage_reports`, `manage_schedules`, `manage_wishlists`, `manage_tickets`, `manage_files`, `manage_roles`, `view_audit_log`, `manage_attendance`.

---

<details>
<summary><h2>⚙️ Technical reference</h2></summary>

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│              React 19 SPA  ·  Socket.io client          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / WS
                    ┌────▼────┐
                    │  Nginx  │  :8080
                    └────┬────┘
          ┌──────────────┼──────────────┐
          │              │              │
     /api/*         /socket.io/      / (SPA)
          │              │
   ┌──────▼──────────────▼──────┐
   │     NestJS Backend :4000   │
   │  REST API + Socket.io GW   │
   └──────┬─────────────────────┘
          │ TypeORM
   ┌──────▼──────┐   ┌──────────────┐
   │ PostgreSQL  │   │ Disk storage │
   │     :5432   │   │  ./uploads   │
   └─────────────┘   └──────────────┘

[Optional]
   Open WebUI :9999  ──► Ollama :11434
```

### Environment Variables

Copy `.env.example` to `.env` and set the following:

| Variable | Description | Default |
|---|---|---|
| `POSTGRES_HOST` | PostgreSQL hostname | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_USER` | DB username | `aiserver` |
| `POSTGRES_PASSWORD` | DB password | *(set a strong value)* |
| `POSTGRES_DB` | Database name | `aiserver_db` |
| `JWT_SECRET` | Access token signing key | *(random string)* |
| `JWT_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_SECRET` | Refresh token signing key | *(random string)* |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` |
| `PORT` | Backend listen port | `4000` |
| `FRONTEND_URL` | CORS allowed origin(s) | `https://portal.lan` |
| `NODE_ENV` | `development` or `production` | `development` |
| `DISCORD_WEBHOOK_SCHEDULE` | Discord webhook — schedules | *(optional)* |
| `DISCORD_WEBHOOK_TASKS` | Discord webhook — tasks | *(optional)* |
| `DISCORD_WEBHOOK_REPORTS` | Discord webhook — reports | *(optional)* |
| `DISCORD_WEBHOOK_TICKETS` | Discord webhook — tickets | *(optional)* |
| `DISCORD_WEBHOOK_FILES` | Discord webhook — files | *(optional)* |
| `UPLOAD_PATH` | Uploaded files location | `./uploads` |
| `MAX_FILE_SIZE_MB` | Max upload size in MB | `10` |
| `DOCUMENTS_PATH` | Papers/manuals storage | `/app/documents` |
| `WEBUI_SECRET_KEY` | Open WebUI secret | *(set a value)* |

### Project Structure

```
AI-Portal/
├── backend/                  # NestJS API
│   ├── src/
│   │   ├── auth/             # JWT auth, refresh tokens, password reset
│   │   ├── users/            # User management
│   │   ├── roles/            # RBAC — custom roles + permission flags
│   │   ├── projects/         # Projects, sub-projects, membership
│   │   ├── tasks/            # Kanban tasks + time tracking
│   │   ├── reports/          # Weekly timesheets + PDF export
│   │   ├── budget/           # Full budget ledger
│   │   ├── wishlists/        # Purchase requests
│   │   ├── schedules/        # Weekly shift scheduling
│   │   ├── inventory/        # Equipment catalogue
│   │   ├── papers/           # Research paper catalogue
│   │   ├── files/            # Project file attachments (manuals, etc.)
│   │   ├── video-tutorials/  # Playlist-based video & PDF tutorials
│   │   ├── uploads/          # Avatar / general uploads
│   │   ├── tickets/          # Bug reports & access requests
│   │   ├── comments/         # Threaded comments
│   │   ├── notifications/    # In-app notifications
│   │   ├── realtime/         # Socket.io gateway
│   │   ├── discord/          # Discord webhook service
│   │   ├── audit/            # Audit trail
│   │   ├── dashboard/        # Aggregated analytics
│   │   └── database/         # schema.sql, seed.sql, migrations
│   └── Dockerfile
├── frontend/                 # React 19 + Vite SPA
│   ├── src/
│   │   ├── pages/            # One folder per route/page
│   │   ├── components/       # Shared UI components
│   │   ├── api/              # Axios client + typed API helpers
│   │   ├── store/            # Zustand auth store
│   │   └── hooks/            # Custom React hooks
│   └── Dockerfile
├── nginx/                    # Reverse proxy config
├── docker-compose.yml        # Production stack
├── docker-compose.dev.yml    # Dev overrides
├── docker-compose.openwebui.yml
├── connect.sh                # Dev entry point (idempotent)
├── start-dev.sh / stop-dev.sh
└── .env.example
```

### API Overview

All endpoints prefixed `/api`. Auth via `Authorization: Bearer <token>`.

| Module | Base path |
|---|---|
| Auth | `/api/auth` |
| Users | `/api/users` |
| Roles | `/api/roles` |
| Projects | `/api/projects` |
| Tasks | `/api/tasks` |
| Reports | `/api/reports` |
| Budget | `/api/budget` |
| Wishlists | `/api/wishlists` |
| Schedules | `/api/schedules` |
| Inventory | `/api/inventory` |
| Papers | `/api/papers` |
| Files | `/api/files` |
| Uploads | `/api/uploads` |
| Tickets | `/api/tickets` |
| Video Tutorials | `/api/video-tutorials` |
| Comments | `/api/comments` |
| Notifications | `/api/notifications` |
| Dashboard | `/api/dashboard` |
| Audit | `/api/audit` |

WebSocket: `ws://your-server:8080/socket.io/`

### Discord Integration

| Webhook | Events |
|---|---|
| `DISCORD_WEBHOOK_TASKS` | Task created, status changed, assigned |
| `DISCORD_WEBHOOK_SCHEDULE` | Weekly schedule posted (with screenshot) |
| `DISCORD_WEBHOOK_REPORTS` | Report submitted, approved, missing-report reminders |
| `DISCORD_WEBHOOK_TICKETS` | Ticket opened, resolved |
| `DISCORD_WEBHOOK_FILES` | File uploaded, video tutorial uploaded, pending approval |

### Scripts

| Script | Description |
|---|---|
| `./connect.sh` | Idempotent dev launcher — start or reconnect. `--restart` to force restart. |
| `./start-dev.sh` | Raw startup — Postgres in Docker, NestJS + Vite on host. |
| `./stop-dev.sh` | Stop everything and free ports. |

</details>

---

<p align="center">
  Built with ❤️ for the <strong>SUU AI/ML Research Lab v1.4</strong>
</p>
