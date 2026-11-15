import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('password_reset_tokens')
export class PasswordResetToken {
    @PrimaryGeneratedColumn('uuid') id: string;

    @Column({ name: 'user_id' }) userId: string;
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'token_hash' }) tokenHash: string;

    @Column({ name: 'expires_at' }) expiresAt: Date;

    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
