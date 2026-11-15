import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
    CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { BudgetAccount } from './budget-account.entity';
import { Project } from '../../projects/project.entity';
import { User } from '../../users/user.entity';

@Entity('project_budget_allocations')
export class ProjectBudgetAllocation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'budget_account_id', type: 'uuid' })
    budgetAccountId: string;

    @ManyToOne(() => BudgetAccount, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'budget_account_id' })
    budgetAccount: BudgetAccount;

    @Column({ name: 'project_id', type: 'uuid' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ name: 'allocated_amount', type: 'numeric', precision: 15, scale: 2 })
    allocatedAmount: number;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
    createdById: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by_id' })
    createdBy: User | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
