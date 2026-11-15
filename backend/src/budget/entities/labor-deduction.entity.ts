import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { BudgetAccount } from './budget-account.entity';
import { User } from '../../users/user.entity';
import { WeeklyReport } from '../../reports/weekly-report.entity';

@Entity('labor_deductions')
export class LaborDeduction {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'weekly_report_id', type: 'uuid', nullable: true })
    weeklyReportId: string | null;

    @ManyToOne(() => WeeklyReport, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'weekly_report_id' })
    weeklyReport: WeeklyReport | null;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'user_id' })
    user: User | null;

    @Column({ name: 'budget_account_id', type: 'uuid' })
    budgetAccountId: string;

    /** Must reference a BudgetAccount with category = 'Labor' */
    @ManyToOne(() => BudgetAccount, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'budget_account_id' })
    budgetAccount: BudgetAccount;

    @Column({ type: 'numeric', precision: 8, scale: 2 })
    hours: number;

    /** Snapshot of the employee's hourly rate at the time of deduction */
    @Column({ name: 'hourly_rate', type: 'numeric', precision: 10, scale: 2 })
    hourlyRate: number;

    /** Computed: hours * hourlyRate */
    @Column({ type: 'numeric', precision: 15, scale: 2 })
    amount: number;

    @Column({ name: 'week_start', type: 'date' })
    weekStart: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
