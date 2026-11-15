/* ═══════════════════════════════════════════════════════════════
   Query key factory.
   ───────────────────────────────────────────────────────────────
   One place that owns every cache key, so invalidation is precise
   instead of guessed. The hierarchy matters: invalidating `qk.tasks.all`
   also invalidates every filtered `qk.tasks.list({...})` beneath it,
   because Query matches keys by prefix.

   This is what replaces the old `load()` pattern — a full refetch of
   /tasks + /projects + /users/directory after every single mutation.
═══════════════════════════════════════════════════════════════ */

export const qk = {
    users: {
        all:       ['users'] as const,
        list:      () => ['users', 'list'] as const,
        directory: () => ['users', 'directory'] as const,
        me:        () => ['users', 'me'] as const,
        detail:    (id: string) => ['users', 'detail', id] as const,
    },

    tasks: {
        all:    ['tasks'] as const,
        list:   (filters?: Record<string, unknown>) => ['tasks', 'list', filters ?? {}] as const,
        detail: (id: string) => ['tasks', 'detail', id] as const,
    },

    projects: {
        all:         ['projects'] as const,
        list:        () => ['projects', 'list'] as const,
        detail:      (id: string) => ['projects', 'detail', id] as const,
        members:     (id: string) => ['projects', 'detail', id, 'members'] as const,
        subProjects: (id: string) => ['projects', 'detail', id, 'subprojects'] as const,
        budget:      (id: string) => ['projects', 'detail', id, 'budget'] as const,
    },

    reports: {
        all:    ['reports'] as const,
        list:   (filters?: Record<string, unknown>) => ['reports', 'list', filters ?? {}] as const,
        detail: (id: string) => ['reports', 'detail', id] as const,
    },

    schedules: {
        all:  ['schedules'] as const,
        week: (weekStart: string) => ['schedules', 'week', weekStart] as const,
    },

    notifications: {
        all:  ['notifications'] as const,
        list: () => ['notifications', 'list'] as const,
    },

    inventory: {
        all:  ['inventory'] as const,
        list: (filters?: Record<string, unknown>) => ['inventory', 'list', filters ?? {}] as const,
    },

    wishlists: {
        all:  ['wishlists'] as const,
        list: () => ['wishlists', 'list'] as const,
    },

    tickets: {
        all:    ['tickets'] as const,
        list:   () => ['tickets', 'list'] as const,
        detail: (id: string) => ['tickets', 'detail', id] as const,
    },

    files: {
        all:    ['files'] as const,
        list:   (filters?: Record<string, unknown>) => ['files', 'list', filters ?? {}] as const,
        folders: (scope?: string) => ['files', 'folders', scope ?? 'root'] as const,
    },

    papers: {
        all:     ['papers'] as const,
        list:    (filters?: Record<string, unknown>) => ['papers', 'list', filters ?? {}] as const,
        detail:  (id: string) => ['papers', 'detail', id] as const,
        folders: () => ['papers', 'folders'] as const,
    },

    manuals: {
        all:     ['manuals'] as const,
        list:    (filters?: Record<string, unknown>) => ['manuals', 'list', filters ?? {}] as const,
        folders: () => ['manuals', 'folders'] as const,
    },

    videoTutorials: {
        all:      ['video-tutorials'] as const,
        list:     (filters?: Record<string, unknown>) => ['video-tutorials', 'list', filters ?? {}] as const,
        playlist: (id: string) => ['video-tutorials', 'playlist', id] as const,
    },

    budget: {
        all:            ['budget'] as const,
        overview:       () => ['budget', 'overview'] as const,
        fundingSources: () => ['budget', 'funding-sources'] as const,
        accounts:       () => ['budget', 'accounts'] as const,
        allocations:    () => ['budget', 'allocations'] as const,
        transfers:      () => ['budget', 'transfers'] as const,
        expenses:       () => ['budget', 'expenses'] as const,
        laborCosts:     (filters?: Record<string, unknown>) => ['budget', 'labor-costs', filters ?? {}] as const,
        reports:        (filters?: Record<string, unknown>) => ['budget', 'reports', filters ?? {}] as const,
        simulations:    () => ['budget', 'simulations'] as const,
    },

    attendance: {
        all:      ['attendance'] as const,
        daily:    (date: string) => ['attendance', 'daily', date] as const,
        weekly:   (weekStart: string) => ['attendance', 'weekly', weekStart] as const,
        biweekly: (start: string) => ['attendance', 'biweekly', start] as const,
        mine:     () => ['attendance', 'mine'] as const,
        status:   () => ['attendance', 'status'] as const,
    },

    dashboard: {
        all:         ['dashboard'] as const,
        stats:       () => ['dashboard', 'stats'] as const,
        leaderboard: (filters?: Record<string, unknown>) => ['dashboard', 'leaderboard', filters ?? {}] as const,
        analytics:   (filters?: Record<string, unknown>) => ['dashboard', 'analytics', filters ?? {}] as const,
    },

    comments: {
        all:    ['comments'] as const,
        thread: (entityType: string, entityId: string) =>
            ['comments', entityType, entityId] as const,
    },
} as const;
