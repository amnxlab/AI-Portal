## Remaining RBAC & Logic Issues – AI-Server

**Context:** This document captures the current set of *remaining* or *newly identified* issues after your recent fixes. It focuses on role/permission logic, privacy, and DB alignment, and outlines a small implementation plan plus a few decisions to confirm with you.

---

## 1. Remaining / New Logic & Permission Bugs

### 1.1 Tasks – `GET /tasks/:id` bypasses visibility rules

- **Location:** `backend/src/tasks/tasks.controller.ts`
- **Current code:**

```44:44:backend/src/tasks/tasks.controller.ts
    @Get(':id')
    findOne(@Param('id') id: string) { return this.tasksService.findById(id); }
```

- **Issue:** Any authenticated user can fetch any task by ID, even if they:
  - Are not the assignee
  - Do not have `view_team_data`
  - Are not a member/leader of the project
- **Impact:** Information disclosure; this endpoint does not respect the scoping enforced by `GET /tasks`.
- **Direction to fix:**
  - Load the task, then:
    - Fetch permissions via `RolesService.getPermissions(req.user.role)`.
    - If user lacks `view_team_data`, only allow access when `task.assigneeId === req.user.id`.
    - Optionally, for `Project_Leader` without `manage_projects`, ensure the user is a leader for `task.projectId` via `projectsService.isLeaderOf(...)`.

---

### 1.2 Projects – several read endpoints are world-readable

- **Location:** `backend/src/projects/projects.controller.ts`
- **Good:** `GET /projects` is now scoped via `view_team_data` vs membership, using `RolesService.getPermissions` and `ProjectsService.findByMember`.
- **Still unprotected:**
  - `GET /projects/:id`
  - `GET /projects/:id/subprojects`
  - `GET /projects/:id/budget`
  - `GET /projects/:id/members`
- **Issue:** Any authenticated user can:
  - View any project’s details
  - See subprojects and members
  - View budget/spent/pending summary
  even when they are not on the project and lack `view_team_data`.
- **Impact:** Project structure and financials are visible beyond intended audiences.
- **Direction to fix:**
  - For `findOne`, `getSubProjects`, `getMembers`:
    - If `perms.view_team_data` → allow.
    - Else require membership: e.g. via a helper that checks whether the current user is in `project_members` for that project.
  - For `getBudget`:
    - Restrict to:
      - Users with `manage_projects`, **or**
      - Users with `lead_projects` who are leaders of that specific project.
    - Add `@UseGuards(RolesGuard)` and `@Permissions('manage_projects')`, then handle the “project leader” exception in controller logic.

---

### 1.3 Tickets – screenshot access ignores ownership/permissions

- **Location:** `backend/src/tickets/tickets.controller.ts` and `tickets.service.ts`
- **Current behavior:**
  - `GET /tickets/screenshot/:filename`:
    - Validates that the file exists on disk.
    - Streams it back without checking:
      - Which ticket it belongs to
      - Who is calling
      - Any permissions
- **Comment vs reality:** The comment says “authenticated users who own the ticket or Admin”, but the implementation only checks for file existence.
- **Impact:** Any authenticated user who learns a screenshot filename can retrieve that image, even if they do not own the ticket.
- **Direction to fix:**
  - Make `serveScreenshot`:
    - Look up the `Ticket` by `screenshotUrl` (filename).
    - Ensure:
      - `ticket.submitterId === req.user.id`, **or**
      - caller has an admin/support permission (e.g. `manage_users` or a future `manage_tickets`).
    - Otherwise throw `ForbiddenException`.

---

### 1.4 Weekly reports – DB constraint vs status values

- **Location:**
  - Entity: `backend/src/reports/weekly-report.entity.ts`
  - Service: `backend/src/reports/reports.service.ts`
  - Schema: `backend/src/database/schema.sql`
- **Code vs schema:**
  - Entity comment and service use statuses: `Draft → Submitted → Approved | Needs Revision`.
  - Service sets:
    - `status = 'Approved'` or `'Needs Revision'`.
  - DB schema currently has:

```162:170:backend/src/database/schema.sql
  status       TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted')),
```

- **Issue:** On first approval/rejection, Postgres will reject the update due to the CHECK constraint (unless already altered manually).
- **Impact:** Review API will fail once the DB schema is applied as-is.
- **Direction to fix:**
  - Update the DB constraint to:
    - `CHECK (status IN ('Draft','Submitted','Approved','Needs Revision'))`
  - Provide a migration script (or updated `schema.sql` plus an ALTER TABLE for existing DBs).

---

### 1.5 Schedules – legacy `'Manager'` role check

- **Location:** `backend/src/schedules/schedules.service.ts` (`postToDiscord`)
- **Current:** Checks `['Admin', 'Manager']` as allowed roles, but:
  - Old `Manager` role has been migrated away by `RolesService.onModuleInit()`.
  - Controller already protects route with `@Permissions('post_discord')`, and `post_discord` is granted to Admin in the canonical roles.
- **Issue:** Today this extra check is effectively redundant; in future, if we grant `post_discord` to another role (e.g. `Project_Leader`), this role-name check will block them even though they have the permission.
- **Direction to fix:**
  - Prefer permission-driven checks only (controller layer using `@Permissions('post_discord')`).
  - Remove or relax the role-name condition, or at least drop `'Manager'` from the list and document the intent.

---

### 1.6 Project members endpoint – no privacy scoping

- **Location:** `backend/src/projects/projects.controller.ts` `getMembers()`
- **Current:** Any authenticated user can hit `GET /projects/:id/members` and see the membership list.
- **Impact:** May be acceptable in some environments; from a stricter RBAC/privacy standpoint, it leaks who is on which project.
- **Direction to fix (if desired):**
  - Require either:
    - `view_team_data`, **or**
    - membership in that project.

---

## 2. Feature Gaps / Misalignments

### 2.1 Password reset – backend implemented, no UI

- **Backend:**
  - `AuthController` has:
    - `POST /auth/forgot-password`
    - `POST /auth/reset-password`
  - `AuthService` implements the logic (one-hour token, single-use, bcrypt hashing).
- **Frontend:**
  - No routes or components call these endpoints; there is no “Forgot password” / “Reset password” flow.
- **Impact:** Password reset exists server-side but is unreachable to end users except via manual API calls.
- **Direction to implement:**
  - Add a “Forgot password?” link on the Login page that triggers `POST /auth/forgot-password`.
  - Add a reset page that accepts the token and new password, then calls `POST /auth/reset-password`.
  - Initially, token delivery can remain admin-mediated (as per current comments), then later integrate email.

---

### 2.2 Frontend still checks raw roles in a few places

- **Example:** Wishlists page

```46:49:frontend/src/pages/Wishlists/WishlistPage.tsx
    const user = useAuthStore((s) => s.user);
    const canApprove = user?.role === 'Admin';
```

- **Backend rule:** Approvals/rejections/purchases are governed by the `manage_projects` permission, not strictly `role === 'Admin'`.
- **Issue:** If another role is granted `manage_projects` (e.g. a dedicated “Lab_Manager”), backend will permit their actions but the UI will hide approve/reject buttons.
- **Direction to fix:**
  - Use `usePermissions().hasPermission('manage_projects')` instead of hardcoded role checks here and in any similar locations.

---

### 2.3 DB integrity for `users.role` is still soft

- **Current:**
  - `users.role` is `TEXT` with no FK to `roles(name)` in `schema.sql`.
  - `UsersService.create` and `UsersService.update` now validate that the role exists via `RolesService.findByName`, which prevents most application-level inconsistencies.
- **Remaining risk:**
  - Direct DB edits (or legacy data) could still leave users with role strings that don’t correspond to any `roles` row; app then treats them as having `DEFAULT_PERMISSIONS` (all false).
- **Optional direction:**
  - Add a DB migration to enforce `FOREIGN KEY (role) REFERENCES roles(name) ON UPDATE CASCADE`.

---

## 3. Things from the Previous Report That Are Now Fixed

*(High level only, to avoid duplicating old material)*  

- Wishlists controller now enforces:
  - Ownership for regular users.
  - `manage_projects` for approval/rejection/purchase actions.
  - Valid status transitions via `WishlistsService.STATUS_TRANSITIONS`.
- Tasks:
  - `GET /tasks` is scoped via `view_team_data`, `lead_projects`, and membership; Lab Assistants/Inventory Manager see only their tasks and can only change certain fields/statuses.
  - Status transitions for self-updates now include `'Done'`.
- Projects:
  - `GET /projects` distinguishes between `view_team_data` (all projects) and membership-based visibility.
- RolesGuard:
  - Now enforces both `@Roles()` and `@Permissions()` together (no early return that skips permission checks).
- Reports:
  - Submissions respect per-user `weeklyHoursCap` (with 20% remote cap) instead of a hard-coded hours limit.
- Schedules:
  - Enforce shift time ordering, same-day overlap detection, and weekly hours caps.
- Frontend:
  - Permission-aware routing via `ProtectedRoute` + `usePermissions`.
  - `/users` and `/roles` correctly require `manage_users`.

---

## 4. Implementation Plan (From Here)

### Phase 1 – Tighten RBAC & Privacy (small, high impact)

1. **Tasks single-task endpoint**
   - Add permission/membership checks to `GET /tasks/:id`, mirroring `findAll` scoping.
2. **Projects read endpoints**
   - Guard `GET /projects/:id`, `/subprojects`, `/budget`, `/members` with `view_team_data` and membership/leader checks.
3. **Tickets screenshots**
   - Implement ownership/permission checks before serving screenshots.
4. **Schedules legacy role check**
   - Remove or refactor the `'Manager'` check in `postToDiscord` to be permission-based only.

### Phase 2 – Data model alignment & UI consistency

5. **Weekly report status constraint**
   - Update DB CHECK to include `'Approved'` and `'Needs Revision'` and add a migration.
6. **Frontend permission alignment**
   - Replace leftover `user.role === 'Admin'` checks with `usePermissions().hasPermission(...)` (start with Wishlists).
7. **Password-reset UI**
   - Add Forgot/Reset password flows on the frontend wired to existing backend endpoints.

### Phase 3 – Optional hardening

8. **DB FK for `users.role`**
   - Add `FOREIGN KEY (role) REFERENCES roles(name)` with `ON UPDATE CASCADE`.
9. **Audit/UI enhancements (optional)**
   - Expand audit logging coverage and optionally add an admin-facing audit viewer page.

---

## 5. Open Questions for Product / Security Policy

These choices affect how strict the implementations in Phase 1 should be:

1. **Project visibility**
   - Should Lab Assistants / Inventory Managers be able to open *any* project detail page (including members and budget), or only projects where they are members?
2. **Ticket screenshot access**
   - Should screenshots be visible only to:
     - the ticket submitter + Admin, or
     - also to other roles (e.g. Project_Leader/support) with a specific permission?
3. **Budget sensitivity**
   - Is project budget data considered sensitive enough to restrict to:
     - Admin + project leaders with `lead_projects`, or
     - all project members / all authenticated users?
4. **RBAC extensibility**
   - Are you planning to add more roles (e.g. QA_Lead, Student_Intern)?  
     If yes, we should prioritize eliminating remaining raw role checks in the frontend and rely exclusively on permissions.

Once these are decided, the next step is to implement Phase 1 with those policy choices baked into the code.