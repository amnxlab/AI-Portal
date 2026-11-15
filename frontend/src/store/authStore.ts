import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
    id: string;
    username: string;
    fullName: string;
    email?: string;
    /** Unified role — always 'Member'. Access is driven by `permissions`. */
    role: string;
    avatarUrl?: string;
    weeklyHoursCap?: number | null;
    /** Position title set by an administrator; drives the tag by their name. */
    jobTitle?: string | null;
    remoteWorkRestricted?: boolean;
    isOnHold?: boolean;
    onlineClockEnabled?: boolean;
    permissions?: Record<string, boolean>;
}

interface AuthState {
    accessToken: string | null;
    user: AuthUser | null;
    setToken: (token: string) => void;
    setUser: (user: AuthUser) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            accessToken: null,
            user: null,
            setToken: (token) => set({ accessToken: token }),
            setUser: (user) => set({ user }),
            logout: () => set({ accessToken: null, user: null }),
        }),
        { name: 'auth-store', partialize: (s) => ({ user: s.user, accessToken: s.accessToken }) },
    ),
);
