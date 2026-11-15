import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne,
    JoinColumn, CreateDateColumn, Unique,
} from 'typeorm';
import { Project } from './project.entity';
import { User }    from '../users/user.entity';

@Entity('project_members')
@Unique(['projectId', 'userId'])
export class ProjectMember {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'project_id' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    /** true  → this member is the Project Leader for this project */
    @Column({ name: 'is_leader', default: false })
    isLeader: boolean;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
