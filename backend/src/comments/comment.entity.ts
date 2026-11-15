import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
    CreateDateColumn, Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * A polymorphic comment that can be attached to any entity:
 *  entity_type  = 'task' | 'ticket' | 'project'
 *  entity_id    = UUID of the parent record
 *  parent_id    = UUID of the parent comment (null = top-level thread)
 */
@Entity('comments')
@Index(['entityType', 'entityId'])
export class Comment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** 'task' | 'ticket' | 'project' */
    @Column({ name: 'entity_type', length: 30 })
    entityType: string;

    @Column({ name: 'entity_id', type: 'uuid' })
    entityId: string;

    @Column({ name: 'author_id', type: 'uuid' })
    authorId: string;

    @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'author_id' })
    author: User;

    @Column({ type: 'text' })
    content: string;

    /** Array of user IDs @mentioned in the comment. */
    @Column({ type: 'jsonb', default: [] })
    mentions: string[];

    /** Parent comment ID for threaded replies. null = top-level. */
    @Column({ name: 'parent_id', type: 'uuid', nullable: true })
    parentId: string | null;

    @Column({ name: 'is_edited', default: false })
    isEdited: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
