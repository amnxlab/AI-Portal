import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('audit_logs')
export class AuditLog {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'actor_id', nullable: true })
    actorId: string;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'actor_id' })
    actor: User;

    @Column({ name: 'entity_type' })
    entityType: string;

    @Column({ name: 'entity_id', nullable: true, type: 'uuid' })
    entityId: string;

    @Column()
    action: string;

    @Column({ name: 'old_value', type: 'jsonb', nullable: true })
    oldValue: any;

    @Column({ name: 'new_value', type: 'jsonb', nullable: true })
    newValue: any;

    @Column({ name: 'ip_address', nullable: true })
    ipAddress: string;

    @CreateDateColumn({ name: 'timestamp' })
    timestamp: Date;
}
