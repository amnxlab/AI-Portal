# Future Versions — Feature Roadmap & Enhancement Suggestions

> Generated after a full codebase review (March 2026).
> Covers all 20+ modules in the AI-Server management platform.
> Items are grouped by module and then by cross-cutting themes.
> Priority tiers: 🔴 High impact / low effort · 🟡 Medium · 🟢 Nice-to-have

---

## Table of Contents

1. [Cross-Cutting / Platform](#1-cross-cutting--platform)
2. [Auth & Security](#2-auth--security)
3. [Projects](#3-projects)
4. [Tasks](#4-tasks)
5. [Weekly Reports / Timesheets](#5-weekly-reports--timesheets)
6. [Budget Management](#6-budget-management)
7. [Inventory](#7-inventory)
8. [Schedule](#8-schedule)
9. [Files & Documents](#9-files--documents)
10. [Research Papers](#10-research-papers)
11. [Video Tutorials](#11-video-tutorials)
12. [Tickets (Bug Reports / Access Requests)](#12-tickets-bug-reports--access-requests)
13. [Wishlists](#13-wishlists)
14. [Comments & Mentions](#14-comments--mentions)
15. [Notifications](#15-notifications)
16. [Dashboard & Analytics](#16-dashboard--analytics)
17. [Users & Roles](#17-users--roles)
18. [Settings](#18-settings)
19. [Developer / Platform Tooling](#19-developer--platform-tooling)
20. [New Modules (Net-New Capabilities)](#20-new-modules-net-new-capabilities)

---

## 1. Cross-Cutting / Platform

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 1.1 | **Email notifications** via SMTP/SendGrid | 🔴 | System currently has in-app + Discord notifications only. Critical events (deadline approaching, task assigned, report approved) should also reach users by email. |
| 1.2 | **Global unified search** | 🔴 | A single search bar (Cmd+K) that searches across tasks, projects, files, papers, tickets, inventory, and users. Backend can use PostgreSQL full-text search (`tsvector`). |
| 1.3 | **Dark / light theme toggle** | 🟡 | UI is hardcoded to GitHub dark palette. Expose a theme switch via Settings and persist to user profile. |
| 1.4 | **Mobile-responsive layout / PWA** | 🟡 | Current layout is desktop-first. Add responsive breakpoints and a Service Worker manifest so it can be installed on mobile. |
| 1.5 | **Internationalization (i18n)** | 🟢 | Externalize all UI strings to locale files using `react-i18next`. Start with Arabic since the team context suggests it. |
| 1.6 | **In-app changelog / What's New** | 🟢 | Show a "What's new" modal after deployments so users know about new features. |
| 1.7 | **Rate limiting on API** | 🔴 | NestJS `@nestjs/throttler` on auth routes especially (login, forgot-password) to prevent brute-force attacks. |
| 1.8 | **Audit log viewer in UI** | 🔴 | The `audit_logs` table is populated by every write action. Build an admin-facing read-only table (`/admin/audit`) with filtering by entity, actor, date range, and action. |
| 1.9 | **Automated DB backup schedule** | 🟡 | Add a cron job (or pg_dump script) that backs up PostgreSQL daily and stores compressed dumps. Admin UI to trigger on-demand restore from a dump. |
| 1.10 | **Export any listing to PDF/Excel** | 🟡 | Standardize an "Export" button across all table views (tasks, reports, inventory, etc.) that emits CSV + PDF via `jsPDF`/`xlsx`. |

---

## 2. Auth & Security

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 2.1 | **Two-factor authentication (2FA)** | 🔴 | TOTP via `speakeasy` or `otplib`. Show a QR code in Profile settings. Admin can enforce 2FA per role. |
| 2.2 | **SSO / OAuth2** | 🟡 | Login with Google / Microsoft Azure AD / GitHub using `passport-google-oauth20`. Useful for institutional lab environments. |
| 2.3 | **Active session management** | 🟡 | Show all active refresh tokens (device, IP, last used) in Profile settings with a "Revoke" button per session. |
| 2.4 | **Login attempt audit & lockout** | 🔴 | Track failed login attempts per username/IP. Lock the account for N minutes after 5 consecutive failures and notify the admin. |
| 2.5 | **Password strength policy enforcement** | 🟡 | Backend validation: minimum 10 chars, at least one number, one uppercase. Show a strength meter on the reset/change password forms. |
| 2.6 | **HTTP security headers** | 🔴 | Add `helmet()` to the NestJS bootstrap (`main.ts`) to set HSTS, CSP, X-Frame-Options. |

---

## 3. Projects

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 3.1 | **Project templates** | 🟡 | Allow admins to save a project (with its sub-projects, task columns, folder structure) as a template and stamp new projects from it. |
| 3.2 | **Gantt chart timeline view** | 🟡 | Visual timeline of tasks/sub-projects. Libraries: `dhtmlx-gantt` or `react-gantt-task`. |
| 3.3 | **Project milestones** | 🟡 | Named milestone dates inside a project. Tasks can be "attached to" a milestone. Dashboard shows milestone % complete. |
| 3.4 | **Project archiving** | 🔴 | Soft-archive completed projects (hidden from default views but accessible in an "Archives" section). Prevents accidental deletion of historical data. |
| 3.5 | **Inter-project task dependencies** | 🟢 | Mark a task in Project B as "blocked by" a task in Project A. Show warnings when the dependent task is overdue. |
| 3.6 | **Project health score** | 🟡 | Composite metric: task completion rate + budget consumption + overdue tasks. Shown as a color-coded badge on the Projects list. |
| 3.7 | **Project cover image / emoji** | 🟢 | Let project leaders pick a cover image or an emoji for easy visual identification in the sidebar and project cards. |

---

## 4. Tasks

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 4.1 | **Task dependencies ("blocked by")** | 🟡 | `task_dependencies` join table. A blocked task cannot move to "In Progress" until its dependency is "Done". |
| 4.2 | **Subtasks / checklist** | 🔴 | Nest checklist items inside a task. Progress bar auto-fills from checked items. Stored as JSONB on the task row. |
| 4.3 | **Recurring tasks** | 🟡 | Mark a task as recurring (daily / weekly / monthly). A cron job creates the next instance when the current one closes. |
| 4.4 | **Task labels & custom tags** | 🟡 | Beyond Priority + Status: free-form color-coded labels (e.g., "Backend", "UX", "Research"). Filterable in Kanban + Table view. |
| 4.5 | **Workload view** | 🔴 | A team calendar-style heatmap showing each user's total assigned task hours per day/week. Helps leaders avoid over-assigning. |
| 4.6 | **Automated deadline reminders** | 🔴 | Cron job that checks tasks with a deadline 24 h / 48 h away and sends a notification (and email) to the assignee. |
| 4.7 | **Bulk actions** | 🟡 | Select multiple tasks in Table view → bulk change status / assignee / priority / delete. |
| 4.8 | **Task clone** | 🟢 | Duplicate a task (including attachments and description) into the same or another project. |
| 4.9 | **In-browser time tracking timer** | 🟡 | Current tracking requires API calls for start/pause/complete. Add a live stopwatch widget in the task detail panel that auto-syncs to the backend. |
| 4.10 | **Burndown chart per project** | 🟡 | Show remaining story points / task count over a sprint timeline. Integrates with the existing `estimatedHours` model. |
| 4.11 | **CSV import for bulk task creation** | 🟢 | Upload a CSV with title, assignee, priority, deadline columns to create tasks in bulk. Useful for onboarding new projects. |

---

## 5. Weekly Reports / Timesheets

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 5.1 | **Auto-populate from task time logs** | 🔴 | When creating a weekly report, pre-fill task hour entries from the actual `actualHours` logged on tasks that week. Currently fully manual. |
| 5.2 | **Bulk approval** | 🔴 | Admins/managers can approve all "Submitted" reports for a given week in one click instead of opening each one. |
| 5.3 | **Overtime / under-hours alert** | 🟡 | Highlight reports where total hours significantly exceed or fall below the user's `weeklyHoursCap`. Currently shows a warning but does not notify. |
| 5.4 | **Leave / absence integration** | 🟡 | Allow a task entry to be marked as "Leave" / "Sick Day" / "Public Holiday" so managers have a full picture. |
| 5.5 | **Payroll export format** | 🟢 | Export approved reports in a format compatible with payroll systems (configurable column mapping → CSV/XLS). |
| 5.6 | **Manager delegation** | 🟢 | Allow an Admin to delegate report-approval authority to a Project Leader for their own project members only. |
| 5.7 | **Historical analytics per user** | 🟡 | User profile page shows a chart of hours tracked per week over the last year. |

---

## 6. Budget Management

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 6.1 | **Budget threshold alerts** | 🔴 | Send a notification (and email) to admins when a project has consumed > 80% / > 95% of its allocated budget. |
| 6.2 | **Invoice upload & linking** | 🔴 | Attach a scanned invoice PDF to any expense entry. Stored in the file system alongside project documents. |
| 6.3 | **Purchase order workflow** | 🟡 | Before an expense is recorded, a PO is created and approved. Mirrors the wishlist approval flow at the financial level. |
| 6.4 | **Recurring expenses** | 🟡 | Mark an expense as recurring (monthly/quarterly). Cron job auto-creates the next period's entry. Useful for rent, subscriptions. |
| 6.5 | **Multi-currency support** | 🟡 | Store a currency code per expense/funding source. Apply a configurable exchange rate for consolidated reporting. |
| 6.6 | **Budget vs. actuals comparison** | 🔴 | Side-by-side table of budgeted amount vs. actual spend per project/account with variance and % columns. |
| 6.7 | **Accounting software export** | 🟢 | Export transactions in QuickBooks IIF or Xero CSV format. |
| 6.8 | **Fiscal year configuration** | 🟢 | Admin setting to define the organization's fiscal year start month. All budget reports then align to it. |

---

## 7. Inventory

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 7.1 | **QR code label generation** | 🔴 | Generate a printable QR code sticker per inventory item (encoding the item ID). Scan to jump directly to its detail view. Use `qrcode` npm package. |
| 7.2 | **Formal checkout / return workflow** | 🔴 | Currently `status = 'Checked Out'` but there is no return date, condition-on-return, or overdue alert. Add a `checkouts` table with `checked_out_at`, `due_back_at`, `returned_at`, and a notification for overdue items. |
| 7.3 | **Maintenance / calibration schedule** | 🟡 | Field `next_maintenance_date` with automatic notifications when due. Logs maintenance events in the inventory audit trail. |
| 7.4 | **Low-stock notification** | 🔴 | Trigger an in-app notification (and email) when `quantity ≤ minQuantity`. Currently only shows a visual badge in the table. |
| 7.5 | **Equipment / resource booking calendar** | 🟡 | Reserve a piece of equipment for a specific date range. Shows a conflict if already booked. Integrates with the Schedule module. |
| 7.6 | **Link wishlist approval → auto-create inventory item** | 🔴 | When a wishlist item's status moves to "Purchased", offer a one-click "Add to Inventory" button that pre-fills the form. The `sourceWishlistItemId` FK already exists on the entity. |
| 7.7 | **Depreciation tracking** | 🟢 | Record purchase price + depreciation method (straight-line / declining). Show current book value in the item detail and budget reports. |

---

## 8. Schedule

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 8.1 | **iCal / Google Calendar export** | 🔴 | Export any user's weekly schedule as an `.ics` file. Users can subscribe to their own schedule in Google Calendar / Outlook. |
| 8.2 | **Conflict detection** | 🔴 | Warn when a new schedule slot overlaps an existing one for the same user on the same day. |
| 8.3 | **Copy previous week** | 🔴 | One-click "Copy last week's schedule" button. Currently users have to re-enter recurring patterns every week. |
| 8.4 | **Meeting room / lab booking** | 🟡 | Extend the schedule to also book shared physical spaces. Distinct calendar view per room. |
| 8.5 | **Auto-suggest from tasks** | 🟢 | After a weekly report is drafted, suggest schedule slots based on the tasks planned for that week. |
| 8.6 | **Availability API for external tools** | 🟢 | Expose a read-only endpoint so external scheduling tools (Calendly, Teams) can check a user's availability. |

---

## 9. Files & Documents

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 9.1 | **Full-text search inside documents** | 🟡 | Index PDF/text content in PostgreSQL `tsvector` (or Apache Tika + Elasticsearch). Search bar in Files page returns matches inside file contents, not just filenames. |
| 9.2 | **Document version history** | 🔴 | When uploading a new version of an existing document, keep the old version accessible. `project_files` gains a `version` integer and a `previous_version_id` pointer. |
| 9.3 | **Inline PDF / Office document viewer** | 🟡 | Currently serves the file for download; consider embedding with `pdfjs-dist` for PDF or OnlyOffice for DOCX/XLSX. |
| 9.4 | **File expiry / retention policy** | 🟢 | Admin can set a maximum age for "draft/pending" files. A cron job auto-rejects and archives stale submissions. |
| 9.5 | **Bulk download as ZIP** | 🟡 | Select multiple files → download as a single ZIP. Backend uses `archiver` npm package to stream the archive. |
| 9.6 | **Digital signature / approval stamp** | 🟢 | Admins can digitally "sign" an approved document (embedded timestamp + signer name in the PDF metadata). |
| 9.7 | **Collaborative annotation** | 🟢 | Inline comment anchors on specific pages of a PDF (similar to Google Docs "suggestion" mode). |

---

## 10. Research Papers

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 10.1 | **DOI auto-fill (CrossRef API)** | 🔴 | When a user pastes a DOI, auto-fetch title, authors, year, venue, and abstract from `api.crossref.org`. Eliminates manual metadata entry. |
| 10.2 | **BibTeX / APA / MLA citation export** | 🔴 | "Copy citation" button on each paper that formats the metadata into the chosen citation style. |
| 10.3 | **Paper recommendation engine** | 🟡 | When viewing a paper, show "Related papers" from the same collection based on overlapping tags or TF-IDF similarity of abstracts. |
| 10.4 | **Reference graph visualization** | 🟢 | Force-directed graph (`react-force-graph`) showing which papers in the collection cite each other (if DOIs are available). |
| 10.5 | **AI-assisted abstract summary** | 🟡 | Send the abstract to an LLM and display a one-paragraph "plain English" summary below the abstract field. |
| 10.6 | **Zotero / Mendeley import** | 🟢 | Accept `.bib` or `.ris` file imports; create Paper records from the parsed entries. |
| 10.7 | **Reading progress & notes per user** | 🟡 | Each user can mark pages read and add private annotations. Separate from the `read_request` workflow. |

---

## 11. Video Tutorials

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 11.1 | **Watch progress tracking** | 🔴 | Record how far each user has watched each video (via `timeupdate` events). Show a % progress bar in the playlist queue and in the pending table. |
| 11.2 | **Quiz / comprehension check** | 🟡 | Attach multiple-choice questions to a video. Users must pass the quiz before the media is marked "complete." Results stored per user. |
| 11.3 | **Chapter markers / timestamps** | 🔴 | Let the uploader define named chapters (e.g., "Intro — 0:00", "Installation — 2:30"). Clicking jumps the player to that timestamp. |
| 11.4 | **Playlist completion certificate** | 🟢 | Auto-issue a PDF badge/certificate with the user's name and date when all media in a playlist is completed. |
| 11.5 | **Video transcription & subtitles** | 🟡 | Run uploaded videos through a transcription service (Whisper API or self-hosted `whisper.cpp`). Display subtitles in the player and make transcripts searchable. |
| 11.6 | **Timed annotations** | 🟢 | Instructors can attach popup callout boxes to specific timestamps while the video plays. |
| 11.7 | **Vimeo / Loom embed support** | 🟢 | The current `toEmbedUrl()` helper only handles YouTube. Extend it to detect and embed Vimeo, Loom, and generic `<iframe>` URLs. |
| 11.8 | **Playlist reorder for all members** | 🟡 | Currently sort order is numeric. Add an explicit drag-and-drop reorder UI for playlist administrators (mirrors the wishlist/kanban pattern already in the app). |

---

## 12. Tickets (Bug Reports / Access Requests)

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 12.1 | **Ticket assignment** | 🔴 | Allow an admin to assign a ticket to a specific team member. Assignee receives a notification and the ticket appears in their task list. |
| 12.2 | **Priority / SLA** | 🟡 | Add a priority field (Critical / High / Medium / Low). Track SLA breach time (e.g., critical tickets auto-escalate if not resolved within 4 hours). |
| 12.3 | **Internal admin notes** | 🟡 | Hidden notes on a ticket visible only to admins — for investigation notes before writing the public resolution. |
| 12.4 | **Ticket categories / labels** | 🟡 | Beyond `bug` and `access_request`: custom categories (Performance, Data Issue, UI Bug, etc.) managed by admins. |
| 12.5 | **Email-to-ticket** | 🟢 | Parse incoming emails (via SendGrid Inbound Parse or Mailgun) and auto-create tickets. |
| 12.6 | **Link ticket to task** | 🔴 | "Create task from this ticket" button. Establishes a FK so fixing the task auto-resolves the ticket. |
| 12.7 | **Requester satisfaction rating** | 🟢 | After a ticket is resolved, send the submitter a 1–5 star satisfaction survey inside the app. |

---

## 13. Wishlists

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 13.1 | **Auto-create inventory on purchase** | 🔴 | When status → "Purchased", auto-create an inventory item pre-filled from the wishlist fields. (FK `sourceWishlistItemId` already exists.) |
| 13.2 | **Vendor / supplier field** | 🟡 | Add a `vendor_name` + `vendor_url` field to wishlist items for quicker purchasing. |
| 13.3 | **Bulk approval** | 🟡 | Admins can select multiple "Requested" items and approve them all in one action. |
| 13.4 | **Estimated delivery date** | 🟢 | Track expected and actual delivery dates. Notify the requester when the item arrives. |
| 13.5 | **Recurring purchase request** | 🟢 | Mark a wishlist item as recurring to automatically re-submit the request each period (e.g., monthly lab consumables). |

---

## 14. Comments & Mentions

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 14.1 | **Reactions / emoji** | 🟡 | Allow users to react to a comment with an emoji (👍 ✅ ❤️). Stored as a JSONB reactions map on the comment row. |
| 14.2 | **Comment editing** | 🔴 | The `isEdited` flag already exists on the entity but there is no edit UI or PATCH endpoint exposed. Implement edit with an edit history diff. |
| 14.3 | **File / image attachments on comments** | 🟡 | Allow attaching images or files directly to a comment thread (multi-part form upload). |
| 14.4 | **Thread resolution** | 🟡 | Mark a comment thread as "Resolved" (collapse it visually). Useful on code-review-style discussions. |
| 14.5 | **Comment search** | 🟢 | Search within a comment thread for a keyword — useful when threads grow long. |
| 14.6 | **Pinned comments** | 🟢 | Admins/leaders can pin an important comment to the top of a thread. |

---

## 15. Notifications

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 15.1 | **Notification preferences per user** | 🔴 | Users choose which event types trigger in-app vs. email vs. Discord notifications. Stored in a `notification_preferences` table. |
| 15.2 | **Email digest** | 🔴 | Daily or weekly summary email of all pending notifications for users who prefer batch updates. |
| 15.3 | **Browser push notifications** | 🟡 | Web Push API (VAPID keys). Opt-in from Settings. Allows notifications even when the tab is not open. |
| 15.4 | **Notification grouping / bundling** | 🟡 | Bundle >3 notifications of the same type (e.g., "5 tasks were assigned to you") into a single grouped card. |
| 15.5 | **Slack integration** | 🟢 | Post to a Slack channel in addition to Discord. Configurable per event type via webhook URL in Settings. |
| 15.6 | **Notification expiry** | 🟢 | Auto-dismiss notifications older than 30 days to keep the notification center clean. |

---

## 16. Dashboard & Analytics

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 16.1 | **Customizable widget layout** | 🟡 | Drag-and-drop dashboard layout (using `react-grid-layout`). Users pin the widgets they care about. |
| 16.2 | **Predictive delivery estimate** | 🟢 | Based on historical team velocity (tasks completed per week), estimate the "likely completion date" for a project. |
| 16.3 | **OKR / goal tracking** | 🟡 | Admins define quarterly Objectives and Key Results. Individual tasks can be linked to KRs. Dashboard progress bars reflect KR completion. |
| 16.4 | **PDF report export** | 🔴 | One-click export of the current dashboard view (charts + tables) to a formatted PDF using `jsPDF`/`html2canvas`. |
| 16.5 | **Cross-project resource report** | 🟡 | A filterable table showing every team member, which projects they're assigned to, and their total allocated hours across all projects. |
| 16.6 | **Scheduled automated reports** | 🟢 | Admin configures a report (e.g., "weekly budget summary") that is generated and emailed to a list of recipients every Monday at 8 AM. |

---

## 17. Users & Roles

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 17.1 | **User groups / departments** | 🟡 | Introduce a `departments` table. Users belong to departments; permission and notification scoping can be department-level. |
| 17.2 | **User onboarding checklist** | 🟢 | New users see a dismissible checklist: "Set your avatar", "Complete your profile", "Join a project", etc. |
| 17.3 | **Profile skill tags** | 🟢 | Users self-tag skills (e.g., Python, ML, Electronics). Leaders see skill tags when assigning tasks. |
| 17.4 | **Impersonation (admin only)** | 🟡 | Admins can temporarily "view as" another user to troubleshoot permission issues. Full audit log entry created. |
| 17.5 | **Bulk user import via CSV** | 🟡 | Upload a CSV to create multiple user accounts at once. Auto-sends welcome emails with temporary passwords. |
| 17.6 | **User deactivation & data anonymization** | 🔴 | When a user leaves, `isActive = false` already works. Add an "Anonymize" option that replaces the user's name/email with generic placeholders while keeping activity records. |

---

## 18. Settings

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 18.1 | **Persist settings to backend** | 🔴 | The Settings page currently renders UI but none of the toggles are persisted. Add a `user_settings` table and a `PATCH /api/users/me/settings` endpoint. |
| 18.2 | **Organization-wide settings panel** | 🔴 | Admin-only section for system defaults: max file size, allowed domains, default role for new signups, SMTP config, Discord webhook URL. |
| 18.3 | **Notification preference center** | 🔴 | Per the Notifications section: checkboxes per event type and per channel (in-app / email / Discord). |
| 18.4 | **API key management** | 🟢 | Generate personal access tokens for headless/CLI access to the API. Show created date, last used, scopes. |
| 18.5 | **White-label branding** | 🟢 | Upload a logo and set a primary accent color. Applied site-wide. Useful if deployed for multiple labs. |

---

## 19. Developer / Platform Tooling

| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| 19.1 | **Swagger / OpenAPI documentation** | 🔴 | NestJS has `@nestjs/swagger` built-in. Add it to `main.ts` to auto-generate interactive API docs at `/api/docs`. |
| 19.2 | **End-to-end test suite** | 🔴 | Expand the existing `test/app.e2e-spec.ts` into a full Cypress / Playwright test suite covering login, task creation, report submission, budget flow. |
| 19.3 | **CI/CD pipeline** | 🔴 | Add a GitHub Actions workflow that: (1) lints frontend + backend, (2) runs unit + e2e tests, (3) builds Docker images, (4) pushes to registry on merge to `main`. |
| 19.4 | **Outgoing webhook system** | 🟡 | Allow admins to register webhook URLs. Post a JSON payload when configured events fire (task created, budget threshold exceeded, etc.). |
| 19.5 | **Multi-tenant support** | 🟢 | Add a `tenant_id` column to all entities. Each organization gets an isolated data space. Useful if the platform is offered as SaaS. |
| 19.6 | **Background job queue** | 🟡 | Replace ad-hoc cron patterns with a proper job queue (`bull` + Redis). Jobs: send emails, generate reports, process large file uploads, run OCR. |
| 19.7 | **Object storage (S3 / MinIO)** | 🟡 | Current file storage is local Docker volume (`./uploads`, `./video_tutorials`). Migrate to an S3-compatible backend (or self-hosted MinIO) for scalability and redundancy. |
| 19.8 | **Health-check endpoint** | 🔴 | Expose `GET /api/health` returning DB connectivity, disk space, and memory. Used by Docker `HEALTHCHECK` and uptime monitors. |
| 19.9 | **Structured logging + error tracking** | 🟡 | Replace `console.log` with `pino` structured JSON logging. Integrate Sentry (or self-hosted Glitchtip) for automatic error alerting. |

---

## 20. New Modules (Net-New Capabilities)

> These are entirely new modules that do not exist anywhere in the current platform.
> Each requires a new backend module, DB tables, and a new frontend page.

---

### 20.1 🤖 Built-in AI Assistant

| Field | Detail |
|-------|--------|
| **What** | A sidebar chat panel that is context-aware of the lab's own live data. |
| **Why now** | `docker-compose.openwebui.yml` already sits in this repo — OpenWebUI/Ollama is deployed alongside the platform. The LLM infrastructure exists; it just needs a data bridge. |
| **Example queries** | "What are my overdue tasks?", "Summarize last month's budget burn for Robotics", "Who has free capacity this week?", "Draft a project status update." |
| **Architecture** | A `POST /api/ai/chat` endpoint that takes a message, injects structured context (user's tasks, project summaries, budget figures) as a system prompt, and forwards to the Ollama API. Streaming response via SSE. |
| **Priority** | 🔴 High — leverages existing infrastructure with minimal new backend work. |

---

### 20.2 🧪 Digital Lab Notebook

| Field | Detail |
|-------|--------|
| **What** | A structured, timestamped experiment journal. Each entry has: date, title, hypothesis, protocol, materials/equipment used (linked to Inventory), observations, results, conclusion, and linked project/task. |
| **Why** | Currently there is no place to log experimental work in a structured way. Researchers upload files or write comments, but there is no immutable scientific record. |
| **Data integrity** | Entries are append-only (no editing after submission, only annotations). Each entry is cryptographically timestamped. |
| **Integrations** | Links to Projects, Tasks, Inventory items (equipment used), and Papers (citations to methods). Entries can be exported to PDF. |
| **Priority** | 🔴 High — the most significant gap for a research lab workflow. |

---

### 20.3 📋 Meeting Management

| Field | Detail |
|-------|--------|
| **What** | Create meetings with attendees, agenda items, live minutes editor, and action item extraction. |
| **Why** | The Schedule module handles time slots but has no concept of a meeting record. Teams currently use external tools (Teams, Notion) for this, creating a context switch. |
| **Workflow** | Create meeting → invite users (notifications sent) → agenda built collaboratively → during meeting: minutes typed inline → after: action items converted to Tasks with one click → minutes PDF exported and stored in Files. |
| **Integrations** | Users, Projects, Tasks, Files, Notifications, Schedule. |
| **Priority** | 🔴 High — closes a daily workflow gap. |

---

### 20.4 🏖️ Leave & Absence Management

| Field | Detail |
|-------|--------|
| **What** | Formal leave request and approval workflow inside the platform. |
| **Why** | Weekly reports have a `weeklyHoursCap`, but there is no mechanism for requesting or approving time off. The Schedule shows availability but cannot express "Ahmed is on leave Jan 15–19". |
| **Leave types** | Vacation, Sick Day, Conference Travel, Public Holiday, Unpaid Leave (configurable by Admin). |
| **Workflow** | Request → Admin/Leader approval (mirrors Wishlist flow) → Calendar shows team availability gaps → Weekly report for that week is auto-flagged as "Leave week" and exempt from hours enforcement. |
| **Integrations** | Users, Schedule, Weekly Reports, Notifications. |
| **Priority** | 🟡 Medium — needed for accuracy of the existing reports system. |

---

### 20.5 🎓 Onboarding & Learning Paths

| Field | Detail |
|-------|--------|
| **What** | Admins define structured onboarding checklists assigned to new team members. Steps include: watch a Video Tutorial playlist, read and acknowledge a Document, complete an equipment safety sign-off, join a project. |
| **Why** | New lab members currently have no guided start. Video Tutorials and Files exist but are passive — there is no enforcement or tracking that a member has actually completed the required material. |
| **Tracking** | Per-user progress visible to their supervisor. Completion events fire notifications. Incomplete mandatory steps block assignment to certain task types. |
| **Integrations** | Video Tutorials, Files/Documents, Inventory (certifications), Tasks, Users, Notifications. |
| **Priority** | 🟡 Medium — especially valuable when the lab grows. |

---

### 20.6 🏆 Grant & Funding Pipeline

| Field | Detail |
|-------|--------|
| **What** | Track the full lifecycle of external funding: from grant application through award to deliverable reporting. |
| **Why** | The Budget module tracks *spending* but has no concept of *where money comes from*. Grant applications have their own lifecycle entirely outside the current system. |
| **Stages** | Idea → Draft → Submitted → Under Review → Awarded / Rejected. Rejected grants can be resubmitted. |
| **Fields** | Agency name, grant program, requested amount, PI/co-PIs, submission deadline, reporting periods, deliverable milestones. |
| **Integration** | An **Awarded** grant automatically seeds a Budget allocation and creates milestone Tasks. Links to Papers (output deliverables) and the Publication Tracker (item 20.7). |
| **Priority** | 🟡 Medium — critical for labs that rely on external funding. |

---

### 20.7 📢 Publication & Research Output Tracker

| Field | Detail |
|-------|--------|
| **What** | Track what the lab is **producing** — distinct from the Papers library which tracks what the lab is *reading*. |
| **Output types** | Journal article, conference paper, thesis, technical report, patent, dataset, software release. |
| **Pipeline** | Idea → Draft → Internal Review → Submitted → Under Review → Major Revision / Minor Revision → Accepted → Published. |
| **Fields** | Title, authors (linked to Users), target venue, submission deadline, DOI (once published). |
| **Integration** | A **Published** record auto-creates an entry in the Papers reading library. Links to Projects and Grant deliverables (item 20.6). |
| **Priority** | 🟡 Medium — closes the loop between research activity and output. |

---

### 20.8 ⚠️ Safety & Compliance Module

| Field | Detail |
|-------|--------|
| **What** | Track lab safety certifications, hazardous material records, and compliance deadlines. |
| **Why** | Labs have mandatory recurring obligations (first aid certification, chemical handling training, equipment operation sign-offs) with real expiry dates. Nothing in the platform currently tracks these. |
| **Components** | (1) **Certifications**: per-user, per-equipment, with expiry dates and renewal reminders. (2) **MSDS library**: safety data sheets linked to Inventory items flagged as hazardous. (3) **Incident log**: near-miss and incident reports with corrective action tracking. |
| **Integrations** | Inventory (equipment + hazardous materials), Users, Notifications (expiry alerts), Files (certificate PDFs). |
| **Priority** | 🟡 Medium — regulatory requirement depending on lab type. |

---

### 20.9 📝 Internal Survey & Feedback Forms

| Field | Detail |
|-------|--------|
| **What** | A lightweight form builder for one-off or recurring internal surveys. |
| **Use cases** | Post-project retrospective, equipment condition report after checkout, lab satisfaction survey, training effectiveness feedback. |
| **Builder** | Admin creates a form with question types: text, rating (1–5), multiple choice, yes/no. Form is assigned to specific users or broadcast to all. Deadline configurable. |
| **Results** | Responses aggregated into charts (bar/pie). Individual responses exportable to CSV. Forms can be linked to a Project or Inventory item for context. |
| **Integrations** | Users, Projects, Inventory, Notifications. |
| **Priority** | 🟢 Nice-to-have. |

---

### 20.10 📖 Knowledge Base / SOP Wiki

| Field | Detail |
|-------|--------|
| **What** | A Confluence-style wiki of structured text pages for SOPs, protocols, policies, and how-to guides — distinct from the Files module which stores binary uploads. |
| **Why** | SOPs and protocols are currently either uploaded as PDFs (not searchable/editable) or scattered in comments. A wiki provides a living, version-controlled, linkable knowledge base. |
| **Features** | Markdown pages with version history, page tree navigation, full-text search, page linking, read-acknowledgement requirement, and a "recently updated" feed on the Dashboard. |
| **Integrations** | Tasks (link SOP from task description), Onboarding checklists (item 20.5), Files (embed or link uploaded PDFs), Projects. |
| **Priority** | 🟢 Nice-to-have — high long-term value; lower urgency than operational modules. |

---

### Priority Summary — New Modules

| Module | Effort | Impact | Recommended Order |
|--------|--------|--------|-------------------|
| 20.3 Meeting Management | Low | High | **1st** |
| 20.2 Digital Lab Notebook | Medium | High | **2nd** |
| 20.1 AI Assistant | Low–Medium | High | **3rd** |
| 20.4 Leave Management | Medium | Medium | **4th** |
| 20.5 Onboarding Paths | Medium | Medium | **5th** |
| 20.6 Grant Pipeline | Medium | High | **6th** |
| 20.7 Publication Tracker | Low | Medium | **7th** |
| 20.8 Safety & Compliance | Medium | Medium | **8th** |
| 20.9 Survey / Forms | Low | Low | **9th** |
| 20.10 Knowledge Base / Wiki | High | Medium | **10th** |

---

*Last updated: March 2026*