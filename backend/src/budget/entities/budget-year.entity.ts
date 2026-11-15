import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

export type BudgetYearStatus = 'active' | 'archived';

/**
 * One year of the lab's budget.
 *
 * A year owns its budget accounts, and everything else hangs off an account,
 * so a year's figures are derived by following those links rather than being
 * copied anywhere. Closing a year therefore moves no money and loses no
 * record: it only marks the year archived, which makes it read-only, and
 * opens the next one.
 */
@Entity('budget_years')
export class BudgetYear {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** The calendar year, unique across the table. */
    @Column({ type: 'int' })
    year: number;

    /** What it is called on screen, e.g. "2026 Budget". */
    @Column({ type: 'varchar', length: 64 })
    label: string;

    /**
     * 'active' for the year currently being spent, 'archived' for a closed
     * one. Exactly one row may be active — the database enforces it with a
     * partial unique index, because "start a new year" is the sort of button
     * that gets double-clicked.
     */
    @Column({ type: 'text', default: 'active' })
    status: BudgetYearStatus;

    @Column({ name: 'opened_at', type: 'timestamptz' })
    openedAt: Date;

    @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
    closedAt: Date | null;

    @Column({ name: 'closed_by_id', type: 'uuid', nullable: true })
    closedById: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'closed_by_id' })
    closedBy: User | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
