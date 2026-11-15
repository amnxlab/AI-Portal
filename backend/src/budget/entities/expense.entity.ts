import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
    CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { ProjectBudgetAllocation } from './project-budget-allocation.entity';
import { Project } from '../../projects/project.entity';
import { User } from '../../users/user.entity';

export type ExpenseCategory = 'equipment' | 'supplies' | 'travel' | 'other';

@Entity('expenses')
export class Expense {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'allocation_id', type: 'uuid' })
    allocationId: string;

    @ManyToOne(() => ProjectBudgetAllocation, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'allocation_id' })
    allocation: ProjectBudgetAllocation;

    @Column({ name: 'project_id', type: 'uuid' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ type: 'varchar', length: 500 })
    description: string;

    @Column({ type: 'numeric', precision: 15, scale: 2 })
    amount: number;

    @Column({
        type: 'text',
        enum: ['equipment', 'supplies', 'travel', 'other'],
        default: 'other',
    })
    category: ExpenseCategory;

    @Column({ type: 'varchar', length: 255, nullable: true })
    vendor: string | null;

    @Column({ name: 'receipt_url', type: 'varchar', length: 1000, nullable: true })
    receiptUrl: string | null;

    @Column({ name: 'expense_date', type: 'date' })
    expenseDate: string;

    @Column({ name: 'recorded_by_id', type: 'uuid', nullable: true })
    recordedById: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'recorded_by_id' })
    recordedBy: User | null;

    /** Soft link to wishlist_items (no FK constraint to avoid circular deps) */
    @Column({ name: 'wishlist_item_id', type: 'uuid', nullable: true })
    wishlistItemId: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
