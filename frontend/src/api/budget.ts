import api from './axios';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FundingSourceType = 'grant' | 'institutional' | 'donation' | 'external' | 'other';
export type BudgetAccountCategory = 'Labor' | 'ProjectSpending';
export type TransferType = 'account_to_account' | 'project_to_project' | 'account_to_project' | 'project_to_account';
export type ExpenseCategory = 'equipment' | 'supplies' | 'travel' | 'other';

export interface FundingSource {
    id: string;
    name: string;
    description: string | null;
    totalAmount: number;
    sourceType: FundingSourceType;
    isActive: boolean;
    createdById: string | null;
    createdBy: { fullName: string } | null;
    createdAt: string;
    updatedAt: string;
    /** Whether this source keeps applying after its budget year closes. */
    carriesOver?: boolean;
    budgetYearId?: string | null;

}

export interface BudgetAccount {
    id: string;
    fundingSources: FundingSource[];
    name: string;
    description: string | null;
    category: BudgetAccountCategory;
    totalAllocated: number;
    balance: number;
    /** Once this date has passed, the account is locked — no new spend, allocations, or transfers. */
    expiresAt: string | null;
    isExpired: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectBudgetAllocation {
    id: string;
    budgetAccountId: string;
    budgetAccount: BudgetAccount;
    projectId: string;
    project: { id: string; name: string };
    allocatedAmount: number;
    notes: string | null;
    createdBy: { fullName: string } | null;
    spent: number;
    balance: number;
    createdAt: string;
    updatedAt: string;
}

export interface BudgetTransfer {
    id: string;
    fromAccountId: string | null;
    toAccountId: string | null;
    fromAllocationId: string | null;
    toAllocationId: string | null;
    fromAccount: BudgetAccount | null;
    toAccount: BudgetAccount | null;
    fromAllocation: (ProjectBudgetAllocation & { project: { name: string } }) | null;
    toAllocation: (ProjectBudgetAllocation & { project: { name: string } }) | null;
    transferType: TransferType;
    amount: number;
    reason: string;
    performedBy: { fullName: string } | null;
    createdAt: string;
}

export interface Expense {
    id: string;
    allocationId: string;
    allocation: ProjectBudgetAllocation;
    projectId: string;
    project: { id: string; name: string };
    description: string;
    amount: number;
    category: ExpenseCategory;
    vendor: string | null;
    receiptUrl: string | null;
    expenseDate: string;
    recordedBy: { fullName: string } | null;
    wishlistItemId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LaborDeduction {
    id: string;
    weeklyReportId: string | null;
    userId: string | null;
    user: { id: string; fullName: string; username: string } | null;
    budgetAccountId: string;
    budgetAccount: BudgetAccount;
    hours: number;
    hourlyRate: number;
    amount: number;
    weekStart: string;
    createdAt: string;
}

export interface SustainabilityPool {
    accountId: string;
    accountName: string;
    fundingSource: string;
    balance: number;
    monthlyBurnRate: number;
    runwayMonths: number | null;
    projectedExhaustionDate: string | null;
}

export interface SustainabilityInfo {
    pools: SustainabilityPool[];
    totalMonthlyBurnRate: number;
    totalDeducted: number;
    totalHours: number;
    deductionCount: number;
    activeMembers: number;
}

export interface LaborPoolMember {
    id: string;
    userId: string;
    user: { id: string; fullName: string; username: string; isActive: boolean; hourlyRate: number | null; weeklyHoursCap: number | null };
    budgetAccountId: string;
    budgetAccount: { id: string; name: string };
    startDate: string;
    endDate: string | null;
    createdById: string | null;
    createdBy: { fullName: string } | null;
    createdAt: string;
}

export interface OverviewData {
    sourcesCount: number;
    /** Which budget year these figures are for, and whether it is read-only. */
    year?: {
        id: string;
        year: number;
        label: string;
        status: 'active' | 'archived';
        openedAt: string;
        closedAt: string | null;
        readOnly: boolean;
    };
    totalAllocated: number;
    totalBalance: number;
    totalLaborDeducted: number;
    totalExpenses: number;
    accountSummaries: {
        id: string;
        name: string;
        category: BudgetAccountCategory;
        fundingSource: string;
        totalAllocated: number;
        balance: number;
    }[];
}

export interface ProjectBudgetReport {
    projectId: string;
    allocations: ProjectBudgetAllocation[];
    expenses: Expense[];
    totalAllocated: number;
    totalSpent: number;
    balance: number;
}

export interface SimulationEmployee {
    userId?: string;
    name: string;
    hourlyRate: number;
    weeklyHours: number;
    included: boolean;
}

export interface SimulationResult {
    monthlyBurnRate: number;
    runwayMonths: number | null;
    exhaustionDate: string | null;
    optimalHourCaps: { name: string; currentHours: number; optimalHours: number }[];
    monthlyTimeline: { month: number; label: string; balance: number }[];
}

// ─── API calls ────────────────────────────────────────────────────────────────

// Funding Sources
export const getSources = (yearId?: string) => api.get<FundingSource[]>('/budget/sources', { params: { yearId } }).then(r => r.data);
export const createSource = (data: Omit<FundingSource, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>) => api.post<FundingSource>('/budget/sources', data).then(r => r.data);
export const updateSource = (id: string, data: Partial<FundingSource>) => api.patch<FundingSource>(`/budget/sources/${id}`, data).then(r => r.data);
export const deleteSource = (id: string) => api.delete(`/budget/sources/${id}`);

// Budget Accounts
export const getAccounts = (yearId?: string) => api.get<BudgetAccount[]>('/budget/accounts', { params: { yearId } }).then(r => r.data);
export const createAccount = (data: { fundingSourceIds: string[]; name: string; description?: string; category: string; totalAllocated: number; expiresAt?: string }) => api.post<BudgetAccount>('/budget/accounts', data).then(r => r.data);
export const updateAccount = (id: string, data: Partial<{ fundingSourceIds: string[]; name: string; description?: string; category: string; totalAllocated: number; expiresAt: string | null }>) => api.patch<BudgetAccount>(`/budget/accounts/${id}`, data).then(r => r.data);
export const deleteAccount = (id: string) => api.delete(`/budget/accounts/${id}`);

// Project Allocations
export const getAllocations = (projectId?: string, yearId?: string) => api.get<ProjectBudgetAllocation[]>('/budget/allocations', { params: { projectId, yearId } }).then(r => r.data);
export const createAllocation = (data: Pick<ProjectBudgetAllocation, 'budgetAccountId' | 'projectId' | 'allocatedAmount' | 'notes'>) => api.post<ProjectBudgetAllocation>('/budget/allocations', data).then(r => r.data);
export const updateAllocation = (id: string, data: Partial<ProjectBudgetAllocation>) => api.patch<ProjectBudgetAllocation>(`/budget/allocations/${id}`, data).then(r => r.data);
export const deleteAllocation = (id: string) => api.delete(`/budget/allocations/${id}`);

// Transfers
export const getTransfers = (yearId?: string) => api.get<BudgetTransfer[]>('/budget/transfers', { params: { yearId } }).then(r => r.data);
export const createTransfer = (data: Omit<BudgetTransfer, 'id' | 'createdAt' | 'fromAccount' | 'toAccount' | 'fromAllocation' | 'toAllocation' | 'performedBy'>) => api.post<BudgetTransfer>('/budget/transfers', data).then(r => r.data);

// Expenses
export const getExpenses = (projectId?: string, allocationId?: string, yearId?: string) => api.get<Expense[]>('/budget/expenses', { params: { projectId, allocationId, yearId } }).then(r => r.data);
export const createExpense = (data: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'allocation' | 'project' | 'recordedBy'>) => api.post<Expense>('/budget/expenses', data).then(r => r.data);
export const updateExpense = (id: string, data: Partial<Expense>) => api.patch<Expense>(`/budget/expenses/${id}`, data).then(r => r.data);
export const deleteExpense = (id: string) => api.delete(`/budget/expenses/${id}`);

// Labor
export const getLaborDeductions = (yearId?: string) => api.get<LaborDeduction[]>('/budget/labor/deductions', { params: { yearId } }).then(r => r.data);
export const laborDeduct = (data: { weeklyReportId: string; budgetAccountId: string }) => api.post<LaborDeduction>('/budget/labor/deduct', data).then(r => r.data);
export const getSustainability = (yearId?: string) => api.get<SustainabilityInfo>('/budget/labor/sustainability', { params: { yearId } }).then(r => r.data);

// Labor Pool Members
export const getPoolMembers = (budgetAccountId?: string) => api.get<LaborPoolMember[]>('/budget/labor-pool', { params: { budgetAccountId } }).then(r => r.data);
export const addPoolMember = (data: { userId: string; budgetAccountId: string; startDate: string; endDate?: string | null }) => api.post<LaborPoolMember>('/budget/labor-pool', data).then(r => r.data);
export const endPoolMember = (id: string, endDate?: string) => api.patch<LaborPoolMember>(`/budget/labor-pool/${id}`, { endDate }).then(r => r.data);
export const deletePoolMember = (id: string) => api.delete(`/budget/labor-pool/${id}`);

// Overview & Reports
export const getOverview = (yearId?: string) => api.get<OverviewData>('/budget/overview', { params: { yearId } }).then(r => r.data);

/* ── Budget years ─────────────────────────────────────────────────────── */

export interface BudgetYearSummary {
    id: string;
    year: number;
    label: string;
    status: 'active' | 'archived';
    openedAt: string;
    closedAt: string | null;
    closedBy: { id: string; fullName: string } | null;
    notes: string | null;
    accountCount: number;
    totalAllocated: number;
    totalBalance: number;
    totalLaborDeducted: number;
    totalExpenses: number;
}

export const getBudgetYears = () => api.get<BudgetYearSummary[]>('/budget/years').then(r => r.data);

export interface CloseYearResult {
    archived: BudgetYearSummary;
    opened: BudgetYearSummary;
    accountsCreated: number;
}

/**
 * Closes the open year and opens the next one. Nothing is deleted: the closed
 * year keeps every account, allocation, expense and labor entry, and becomes
 * read-only.
 */
export const closeBudgetYear = (data: { year?: number; label?: string; carryStructure?: boolean; notes?: string }) =>
    api.post<CloseYearResult>('/budget/years/close', data).then(r => r.data);
export const getProjectBudgetReport = (projectId: string) => api.get<ProjectBudgetReport>(`/budget/reports/project/${projectId}`).then(r => r.data);

export interface AccountReport {
    account: BudgetAccount & { balance: number };
    allocations: (ProjectBudgetAllocation & { spent: number; balance: number })[];
    expenses: Expense[];
    laborDeductions: LaborDeduction[];
    totalExpenses: number;
    totalLabor: number;
    totalSpent: number;
}
export const getAccountReport = (accountId: string) =>
    api.get<AccountReport>(`/budget/accounts/${accountId}/report`).then(r => r.data);
export const exportAccountReportPdf = (accountId: string, includeAllocations = true) =>
    api.get(`/budget/export/account-report/${accountId}`, {
        params: { includeAllocations: includeAllocations ? undefined : 'false' },
        responseType: 'blob',
    });

// Wishlist Purchase — creates expense + inventory item in one atomic action
export interface PurchaseWishlistItemPayload {
    allocationId: string;
    expenseDate: string;
    category?: 'equipment' | 'supplies' | 'travel' | 'other';
    vendor?: string;
    receiptUrl?: string;
    inventoryName?: string;
    inventoryCategory?: string;
    inventoryQuantity?: number;
    inventoryUnit?: string;
    inventoryLocation?: string;
    inventoryCondition?: string;
}
export const purchaseWishlistItem = (wishlistItemId: string, data: PurchaseWishlistItemPayload) =>
    api.post(`/wishlists/${wishlistItemId}/purchase`, data).then(r => r.data);

// Export
export const exportCsv = (type: 'overview' | 'expenses' | 'labor') => {
    window.open(`/api/budget/export/csv?type=${type}`, '_blank');
};
export const exportPdf = (type: 'overview' | 'expenses' | 'labor') => {
    window.open(`/api/budget/export/pdf?type=${type}`, '_blank');
};

// Simulation (stateless compute)
export const simulate = (data: { laborBalance: number; employees: SimulationEmployee[]; targetDate?: string }) =>
    api.post<SimulationResult>('/budget/simulate', data).then(r => r.data);

// Simulation Snapshots (persisted in DB)
export interface SimulationSnapshotApi {
    id: string;
    name: string;
    laborBalance: number;
    simMonths: number;
    simStartIso: string;
    members: any;
    createdById: string | null;
    createdBy: { fullName: string } | null;
    createdAt: string;
    updatedAt: string;
}

export const getSimulationSnapshots = () =>
    api.get<SimulationSnapshotApi[]>('/budget/simulations').then(r => r.data);

export const saveSimulationSnapshot = (data: {
    name: string;
    laborBalance: number;
    simMonths: number;
    simStartIso: string;
    members: any;
}) => api.post<SimulationSnapshotApi>('/budget/simulations', data).then(r => r.data);

export const updateSimulationSnapshot = (id: string, data: Partial<{
    name: string;
    laborBalance: number;
    simMonths: number;
    simStartIso: string;
    members: any;
}>) => api.patch<SimulationSnapshotApi>(`/budget/simulations/${id}`, data).then(r => r.data);

export const deleteSimulationSnapshot = (id: string) =>
    api.delete(`/budget/simulations/${id}`);
