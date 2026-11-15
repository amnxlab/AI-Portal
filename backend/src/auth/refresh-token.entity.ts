import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'token_hash' })
    tokenHash: string;

    @Column({ name: 'expires_at' })
    expiresAt: Date;

    /**
     * When this token was rotated (exchanged for a newer one). NULL while the
     * token is the active one. Used for the short reuse-grace window that
     * absorbs concurrent refreshes from multiple tabs/parallel requests —
     * the race that previously deleted the token out from under the second
     * caller and force-logged the user out.
     */
    @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
    rotatedAt: Date | null;

    /** Token hash that replaced this one on rotation (diagnostics only). */
    @Column({ name: 'replaced_by_hash', type: 'varchar', nullable: true })
    replacedByHash: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
