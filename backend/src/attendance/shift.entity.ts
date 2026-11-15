import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
    ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * A recurring window during which people are expected to be in.
 *
 * Attendance on its own records only what happened. A shift is what was
 * supposed to happen, which is what makes "late", "absent" and "covered"
 * answerable at all.
 *
 * The times are local wall-clock, stored as TIME rather than timestamps:
 * "the morning shift starts at 09:00" has to stay true across a daylight
 * saving change, and an absolute instant would drift by an hour.
 */
@Entity('shifts')
export class Shift {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    name: string;

    /** Local wall-clock start, 'HH:MM:SS'. */
    @Column({ name: 'start_time', type: 'time' })
    startTime: string;

    /**
     * Local wall-clock end, 'HH:MM:SS'. An end earlier than the start means
     * the shift runs past midnight into the next day.
     */
    @Column({ name: 'end_time', type: 'time' })
    endTime: string;

    /** ISO weekdays the shift runs on: 1 = Monday … 7 = Sunday. */
    @Column({ name: 'days_of_week', type: 'smallint', array: true, default: () => `'{1,2,3,4,5}'` })
    daysOfWeek: number[];

    /** Minutes after the start before an arrival counts as late. */
    @Column({ name: 'grace_minutes', type: 'smallint', default: 10 })
    graceMinutes: number;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdById: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    createdBy: User | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}

/**
 * A person's time on a shift.
 *
 * Open-ended until `endDate` is set. Changing a rota adds or ends an
 * assignment rather than editing one, so last month's lateness is still
 * judged against the shift that actually applied then.
 */
@Entity('shift_assignments')
export class ShiftAssignment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'shift_id', type: 'uuid' })
    shiftId: string;

    @ManyToOne(() => Shift, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'shift_id' })
    shift: Shift;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'start_date', type: 'date' })
    startDate: string;

    /** null while the assignment is ongoing. */
    @Column({ name: 'end_date', type: 'date', nullable: true })
    endDate: string | null;

    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdById: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
