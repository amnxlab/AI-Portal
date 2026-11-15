import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
    CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

export type FundingSourceType = 'grant' | 'institutional' | 'donation' | 'external' | 'other';

@Entity('funding_sources')
export class FundingSource {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ name: 'total_amount', type: 'numeric', precision: 15, scale: 2, default: 0 })
    totalAmount: number;

    @Column({
        name: 'source_type',
        type: 'text',
        enum: ['grant', 'institutional', 'donation', 'external', 'other'],
        default: 'other',
    })
    sourceType: FundingSourceType;

    /**
     * The budget year this source was raised in.
     *
     * It is only offered in that year's lists unless `carriesOver` is set —
     * so last year's spent grant cannot quietly fund this year's accounts.
     */
    @Column({ name: 'budget_year_id', type: 'uuid', nullable: true })
    budgetYearId: string | null;

    /**
     * Whether this source keeps applying after its year closes.
     *
     * True for a multi-year award, which is the same award either way. False
     * for a one-off, which ends with its year. Nothing in the data
     * distinguishes them, so this is set by hand when the source is recorded.
     */
    @Column({ name: 'carries_over', type: 'boolean', default: false })
    carriesOver: boolean;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

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
