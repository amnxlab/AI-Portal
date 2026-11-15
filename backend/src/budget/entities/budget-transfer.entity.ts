import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { BudgetAccount } from './budget-account.entity';
import { ProjectBudgetAllocation } from './project-budget-allocation.entity';
import { User } from '../../users/user.entity';

export type TransferType =
    | 'account_to_account'
    | 'project_to_project'
    | 'account_to_project'
    | 'project_to_account';

@Entity('budget_transfers')
export class BudgetTransfer {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'from_account_id', type: 'uuid', nullable: true })
    fromAccountId: string | null;

    @ManyToOne(() => BudgetAccount, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'from_account_id' })
    fromAccount: BudgetAccount | null;

    @Column({ name: 'to_account_id', type: 'uuid', nullable: true })
    toAccountId: string | null;

    @ManyToOne(() => BudgetAccount, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'to_account_id' })
    toAccount: BudgetAccount | null;

    @Column({ name: 'from_allocation_id', type: 'uuid', nullable: true })
    fromAllocationId: string | null;

    @ManyToOne(() => ProjectBudgetAllocation, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'from_allocation_id' })
    fromAllocation: ProjectBudgetAllocation | null;

    @Column({ name: 'to_allocation_id', type: 'uuid', nullable: true })
    toAllocationId: string | null;

    @ManyToOne(() => ProjectBudgetAllocation, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'to_allocation_id' })
    toAllocation: ProjectBudgetAllocation | null;

    @Column({
        name: 'transfer_type',
        type: 'text',
        enum: ['account_to_account', 'project_to_project', 'account_to_project', 'project_to_account'],
    })
    transferType: TransferType;

    @Column({ type: 'numeric', precision: 15, scale: 2 })
    amount: number;

    @Column({ type: 'text' })
    reason: string;

    @Column({ name: 'performed_by_id', type: 'uuid', nullable: true })
    performedById: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'performed_by_id' })
    performedBy: User | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
