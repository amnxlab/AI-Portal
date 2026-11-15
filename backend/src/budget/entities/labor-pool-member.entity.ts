import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { BudgetAccount } from './budget-account.entity';

/**
 * Tracks which employees are enrolled in a Labor payroll pool
 * and for what date range (startDate → endDate, null = still active).
 */
@Entity('labor_pool_members')
export class LaborPoolMember {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'budget_account_id' })
    budgetAccountId: string;

    @ManyToOne(() => BudgetAccount, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'budget_account_id' })
    budgetAccount: BudgetAccount;

    /** Date this employee started billing to this pool (YYYY-MM-DD) */
    @Column({ name: 'start_date', type: 'date' })
    startDate: string;

    /** Date this employee stopped billing (null = currently active) */
    @Column({ name: 'end_date', type: 'date', nullable: true })
    endDate: string | null;

    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdById: string | null;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'created_by' })
    createdBy: User | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
