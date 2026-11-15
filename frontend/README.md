## AI-Server Frontend (React + Vite)

This directory contains the **React SPA** for AI-Server — a dark-themed, GitHub‑style UI for managing lab schedules, inventory, projects, tasks, wishlists, reports, and more.

For platform-level details (backend, architecture, deployment), see the root `README.md`.

---

## Tech Stack

- React + TypeScript + Vite
- Ant Design (custom GitHub‑dark theme)
- React Router
- Zustand for state management
- Axios for HTTP
- React Big Calendar for schedules
- Recharts for charts
- Socket.io client for real-time updates

---

## Local Development

From the `frontend/` directory:

```bash
npm install
npm run dev
```

By default, Vite will start at `http://localhost:5173`.  
The app expects the backend to be running (usually at `http://localhost:4000/api` in local dev) and will call it via the configured API base URL (see `src/api`).

---

## Application Structure

Key folders under `src/`:

- `pages/` — top-level pages such as `Dashboard`, `Schedule`, `Inventory`, `Tasks`, `Projects`, `Wishlists`, `Reports`, `Files`, `Tickets`, `Users`, `Roles`, `Profile`, `Settings`, `Manuals`, and `Login`.
- `components/` — shared UI components (layout shell, navigation, widgets, forms, etc.).
- `store/` — Zustand stores, including authentication and domain-specific stores.
- `api/` — Axios instance and API helpers/hooks for talking to the backend.
- `hooks/` — custom hooks (e.g., permissions, socket handling).
- `assets/` — logos, icons, and static visuals.

Routes and permission checks are wired in `App.tsx` using a `ProtectedRoute` component that enforces both authentication and fine-grained permissions (e.g., `manage_users`).

---

## Production Build

To create an optimized production build:

```bash
npm run build
```

The built assets will be output to `dist/` and are served in production by the Nginx container defined in the root `docker-compose.yml`.

