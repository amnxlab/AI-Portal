import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Skeleton } from 'antd';
import { useAuthStore } from './store/authStore';
import { usePermissions, type RolePermissions } from './hooks/usePermissions';
import { ThemeProvider } from './theme/ThemeProvider';
import { queryClient } from './api/queryClient';
import AppLayout from './components/AppLayout';
import RouteBoundary from './components/RouteBoundary';
import { lazyWithReload } from './lib/lazyWithReload';

/* ── Routes ────────────────────────────────────────────────────
   Every page is lazily imported. Previously all 21 were eager, which put
   the whole app — plus recharts, html2canvas and react-big-calendar — into
   a single 3.1 MB chunk that had to download before the login form could
   render. Login now pulls only what it needs.

   AppLayout stays eager: it is the shell, required on every authed route,
   so deferring it would just add a waterfall.                             */

const LoginPage           = lazyWithReload('LoginPage', () => import('./pages/Login/LoginPage'));
const ForgotPasswordPage  = lazyWithReload('ForgotPasswordPage', () => import('./pages/Login/ForgotPasswordPage'));
const ResetPasswordPage   = lazyWithReload('ResetPasswordPage', () => import('./pages/Login/ResetPasswordPage'));
const RegisterPage        = lazyWithReload('RegisterPage', () => import('./pages/Login/RegisterPage'));
const HomePage            = lazyWithReload('HomePage', () => import('./pages/Home/HomePage'));
const DashboardPage       = lazyWithReload('DashboardPage', () => import('./pages/Dashboard/DashboardPage'));
const SchedulePage        = lazyWithReload('SchedulePage', () => import('./pages/Schedule/SchedulePage'));
const InventoryPage       = lazyWithReload('InventoryPage', () => import('./pages/Inventory/InventoryPage'));
const TasksPage           = lazyWithReload('TasksPage', () => import('./pages/Tasks/TasksPage'));
const ProjectsPage        = lazyWithReload('ProjectsPage', () => import('./pages/Projects/ProjectsPage'));
const ProjectDetailPage   = lazyWithReload('ProjectDetailPage', () => import('./pages/Projects/ProjectDetailPage'));
const WishlistPage        = lazyWithReload('WishlistPage', () => import('./pages/Wishlists/WishlistPage'));
const ReportsPage         = lazyWithReload('ReportsPage', () => import('./pages/Reports/ReportsPage'));
const UsersPage           = lazyWithReload('UsersPage', () => import('./pages/Users/UsersPage'));
const ProfilePage         = lazyWithReload('ProfilePage', () => import('./pages/Profile/ProfilePage'));
const SettingsPage        = lazyWithReload('SettingsPage', () => import('./pages/Settings/SettingsPage'));
const ManualsPage         = lazyWithReload('ManualsPage', () => import('./pages/Manuals/ManualsPage'));
const FilesPage           = lazyWithReload('FilesPage', () => import('./pages/Files/FilesPage'));
const PapersPage          = lazyWithReload('PapersPage', () => import('./pages/Papers/PapersPage'));
const VideoTutorialsPage  = lazyWithReload('VideoTutorialsPage', () => import('./pages/VideoTutorials/VideoTutorialsPage'));
const TicketsPage         = lazyWithReload('TicketsPage', () => import('./pages/Tickets/TicketsPage'));
const BudgetPage          = lazyWithReload('BudgetPage', () => import('./pages/Budget/BudgetPage'));
const AttendancePage      = lazyWithReload('AttendancePage', () => import('./pages/Attendance/AttendancePage'));
const ReadersPage         = lazyWithReload('ReadersPage', () => import('./pages/Readers/ReadersPage'));
const NotificationsPage   = lazyWithReload('NotificationsPage', () => import('./pages/Notifications/NotificationsPage'));

function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
    return null;
}

/** Shown while a route chunk downloads. Shaped like page content rather than
 *  a spinner so the layout doesn't jump when the real page arrives. */
function RouteFallback() {
    return (
        <div style={{ padding: 4 }}>
            <Skeleton active title={{ width: 240 }} paragraph={{ rows: 1, width: ['40%'] }} />
            <div style={{ marginTop: 32 }}>
                <Skeleton active paragraph={{ rows: 6 }} />
            </div>
        </div>
    );
}

/** Wraps routed content so one page's crash or slow chunk stays contained.
 *  Keyed on pathname so navigating away from a crashed page recovers. */
function RouteShell({ children }: { children: React.ReactNode }) {
    const { pathname } = useLocation();
    return (
        <RouteBoundary resetKey={pathname}>
            <Suspense fallback={<RouteFallback />}>{children}</Suspense>
        </RouteBoundary>
    );
}

const ProtectedRoute: React.FC<{
    children: React.ReactNode;
    permission?: keyof RolePermissions;
    /** Extra allowance evaluated alongside `permission` — used where access
     *  is granted by an account flag rather than a role permission. */
    allowIf?: (user: NonNullable<ReturnType<typeof useAuthStore.getState>['user']>) => boolean;
}> = ({ children, permission, allowIf }) => {
    const user = useAuthStore((s) => s.user);
    const { hasPermission, isLoading } = usePermissions();
    const location = useLocation();

    /*
     * Sign-in has to come back here.
     *
     * This used to send people to a bare /login, which threw the
     * destination away: following an emailed link to a task while signed
     * out landed you on the dashboard with no idea what you had clicked.
     * The intended path travels in `?next=` and the login page returns to
     * it — in the query string, so it survives a reload of the login page.
     */
    if (!user) {
        const target = `${location.pathname}${location.search}`;
        return (
            <Navigate
                to={target && target !== '/' ? `/login?next=${encodeURIComponent(target)}` : '/login'}
                replace
            />
        );
    }

    if (permission || allowIf) {
        const allowedByFlag = allowIf?.(user) ?? false;

        // Wait for permissions before deciding. The previous version rendered
        // children while `isLoading` was true and only redirected afterwards,
        // which flashed the contents of a restricted page at users who could not
        // access it. Unless a flag already grants access, in which case there
        // is nothing to wait for.
        if (isLoading && !allowedByFlag) return <RouteFallback />;

        if (!allowedByFlag && permission && !hasPermission(permission)) {
            return <Navigate to="/home" replace />;
        }
    }

    return <>{children}</>;
};

export default function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <BrowserRouter>
                    <ScrollToTop />
                    <Routes>
                        <Route path="/login"           element={<RouteShell><LoginPage /></RouteShell>} />
                        <Route path="/forgot-password" element={<RouteShell><ForgotPasswordPage /></RouteShell>} />
                        <Route path="/reset-password"  element={<RouteShell><ResetPasswordPage /></RouteShell>} />
                        {/* Where an invited member claims their account. */}
                        <Route path="/register"        element={<RouteShell><RegisterPage /></RouteShell>} />

                        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                            <Route index element={<Navigate to="/home" replace />} />

                            <Route path="home"      element={<RouteShell><HomePage /></RouteShell>} />
                            <Route path="dashboard" element={<RouteShell><DashboardPage /></RouteShell>} />
                            <Route path="schedule"  element={<RouteShell><SchedulePage /></RouteShell>} />
                            <Route path="inventory" element={<RouteShell><InventoryPage /></RouteShell>} />
                            <Route path="tasks"     element={<RouteShell><TasksPage /></RouteShell>} />
                            <Route path="projects"  element={<RouteShell><ProjectsPage /></RouteShell>} />
                            <Route path="projects/:id" element={<RouteShell><ProjectDetailPage /></RouteShell>} />
                            <Route path="wishlists" element={<RouteShell><WishlistPage /></RouteShell>} />
                            <Route path="reports"   element={<RouteShell><ReportsPage /></RouteShell>} />
                            <Route path="manuals"   element={<RouteShell><ManualsPage /></RouteShell>} />
                            <Route path="files"     element={<RouteShell><FilesPage /></RouteShell>} />
                            <Route path="papers"    element={<RouteShell><PapersPage /></RouteShell>} />
                            <Route path="video-tutorials" element={<RouteShell><VideoTutorialsPage /></RouteShell>} />
                            <Route path="tickets"   element={<RouteShell><TicketsPage /></RouteShell>} />

                            <Route path="users" element={
                                <ProtectedRoute permission="manage_users">
                                    <RouteShell><UsersPage /></RouteShell>
                                </ProtectedRoute>
                            } />
                            <Route path="roles" element={<Navigate to="/users" replace />} />
                            <Route path="budget" element={
                                <ProtectedRoute permission="manage_budget">
                                    <RouteShell><BudgetPage /></RouteShell>
                                </ProtectedRoute>
                            } />
                            {/* Attendance managers see the full attendance module; everyone else gets in only if
                                self-service clocking is enabled and they're not on hold. */}
                            {/* Device administration, deliberately not a tab —
                                see pages/Readers/ReadersPage.tsx */}
                            <Route path="readers" element={
                                <ProtectedRoute permission="manage_attendance">
                                    <RouteShell><ReadersPage /></RouteShell>
                                </ProtectedRoute>
                            } />

                            <Route path="attendance" element={
                                <ProtectedRoute
                                    permission="manage_attendance"
                                    allowIf={(u) => !!u.onlineClockEnabled && !u.isOnHold}
                                >
                                    <RouteShell><AttendancePage /></RouteShell>
                                </ProtectedRoute>
                            } />

                            <Route path="profile"       element={<RouteShell><ProfilePage /></RouteShell>} />
                            <Route path="settings"      element={<RouteShell><SettingsPage /></RouteShell>} />
                            <Route path="notifications" element={<RouteShell><NotificationsPage /></RouteShell>} />
                        </Route>

                        <Route path="*" element={<Navigate to="/home" replace />} />
                    </Routes>
                </BrowserRouter>
            </ThemeProvider>
        </QueryClientProvider>
    );
}
