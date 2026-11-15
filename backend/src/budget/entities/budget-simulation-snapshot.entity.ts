import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
    CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('budget_simulation_snapshots')
export class BudgetSimulationSnapshot {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ name: 'labor_balance', type: 'numeric', precision: 15, scale: 2 })
    laborBalance: number;

    @Column({ name: 'sim_months', type: 'int' })
    simMonths: number;

    @Column({ name: 'sim_start_iso', type: 'date' })
    simStartIso: string;

    /** Full members array (SimMember[]) stored as JSONB */
    @Column({ type: 'jsonb' })
    members: any;

    @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
    createdById: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by_id' })
    createdBy: User | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
