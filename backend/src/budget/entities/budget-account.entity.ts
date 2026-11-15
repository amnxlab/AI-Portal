import {
    Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable,
    CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { FundingSource } from './funding-source.entity';

export type BudgetAccountCategory = 'Labor' | 'ProjectSpending';

@Entity('budget_accounts')
export class BudgetAccount {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToMany(() => FundingSource, { eager: false })
    @JoinTable({
        name: 'budget_account_funding_sources',
        joinColumn: { name: 'budget_account_id', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'funding_source_id', referencedColumnName: 'id' },
    })
    fundingSources: FundingSource[];

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({
        type: 'text',
        enum: ['Labor', 'ProjectSpending'],
    })
    category: BudgetAccountCategory;

    @Column({ name: 'total_allocated', type: 'numeric', precision: 15, scale: 2, default: 0 })
    totalAllocated: number;

    /** Once this date has passed, the account is locked: no new spend,
     *  allocations, or transfers in either direction. Null means no deadline. */
    /**
     * The budget year this account belongs to.
     *
     * Everything else in the budget hangs off an account, so this one column
     * is what assigns allocations, expenses and labor deductions to a year —
     * without any of them having to carry a year of their own, or be moved
     * when a year is closed.
     */
    @Column({ name: 'budget_year_id', type: 'uuid', nullable: true })
    budgetYearId: string | null;

    @Column({ name: 'expires_at', type: 'date', nullable: true })
    expiresAt: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
