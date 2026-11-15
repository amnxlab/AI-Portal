import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

/**
 * A single-use invitation to finish setting up an account.
 *
 * Only the hash is stored, exactly as for password-reset tokens: whoever
 * reads the database still cannot claim somebody's account with what they
 * find there. `usedAt` is kept rather than deleting the row so a second click
 * on the same link can say "this link has already been used" instead of the
 * indistinguishable "this link is not valid".
 */
@Entity('registration_tokens')
export class RegistrationToken {
    @PrimaryGeneratedColumn('uuid') id: string;

    @Column({ name: 'user_id' }) userId: string;
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'token_hash' }) tokenHash: string;

    @Column({ name: 'expires_at' }) expiresAt: Date;

    @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
    usedAt: Date | null;

    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
