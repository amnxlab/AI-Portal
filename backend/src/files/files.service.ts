import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectFile } from './project-file.entity';
import { User } from '../users/user.entity';
import * as fs from 'fs';
import * as path from 'path';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { effectivePermissions } from '../roles/role.entity';

@Injectable()
export class FilesService {
    constructor(
        @InjectRepository(ProjectFile)
        private readonly repo: Repository<ProjectFile>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        private readonly notificationsService: NotificationsService,
        private readonly realtimeGateway: RealtimeGateway,
    ) {}

    async findByProject(
        projectId: string,
        type?: string,
        includeAll = false,
        folderId?: string | null,
        viewerId?: string,
    ): Promise<ProjectFile[]> {
        const query = this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .where('f.project_id = :projectId', { projectId });
        if (type) query.andWhere('f.type = :type', { type });
        if (!includeAll) {
            // Approved files, plus your own submissions still waiting. Without
            // the second half, uploading appeared to do nothing: the file was
            // recorded as pending and then vanished from the only list the
            // submitter can see.
            if (viewerId) {
                query.andWhere('(f.status = :approved OR f.uploader_id = :viewerId)', {
                    approved: 'approved', viewerId,
                });
            } else {
                query.andWhere('f.status = :approved', { approved: 'approved' });
            }
        }
        // folderId=null means root (items not in any folder)
        if (folderId !== undefined) {
            if (folderId === null) {
                query.andWhere('f.folder_id IS NULL');
            } else {
                query.andWhere('f.folder_id = :folderId', { folderId });
            }
        }
        return query.orderBy('f.created_at', 'DESC').getMany();
    }

    async findAllApprovedDocuments(projectIds?: string[]): Promise<ProjectFile[]> {
        const qb = this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.type = :type', { type: 'document' })
            .andWhere('f.status = :status', { status: 'approved' });
        if (projectIds !== undefined) {
            if (projectIds.length === 0) return [];
            qb.andWhere('f.project_id IN (:...projectIds)', { projectIds });
        }
        return qb.orderBy('project.name', 'ASC').addOrderBy('f.created_at', 'DESC').getMany();
    }

    async findPendingDocuments(): Promise<ProjectFile[]> {
        return this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.type = :type', { type: 'document' })
            .andWhere('f.status = :status', { status: 'pending' })
            .orderBy('f.created_at', 'ASC')
            .getMany();
    }

    async findAllApprovedManuals(projectIds?: string[]): Promise<ProjectFile[]> {
        const qb = this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.type = :type', { type: 'manual' })
            .andWhere('f.status = :status', { status: 'approved' });
        if (projectIds !== undefined) {
            if (projectIds.length === 0) return [];
            qb.andWhere('f.project_id IN (:...projectIds)', { projectIds });
        }
        return qb.orderBy('project.name', 'ASC').addOrderBy('f.version', 'DESC').getMany();
    }

    async findPendingManuals(): Promise<ProjectFile[]> {
        return this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.type = :type', { type: 'manual' })
            .andWhere('f.status = :status', { status: 'pending' })
            .orderBy('f.created_at', 'ASC')
            .getMany();
    }

    async findAllApprovedPaperFiles(): Promise<ProjectFile[]> {
        return this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.type = :type', { type: 'paper' })
            .andWhere('f.status = :status', { status: 'approved' })
            .orderBy('f.created_at', 'DESC')
            .getMany();
    }

    async findPendingPaperFiles(): Promise<ProjectFile[]> {
        return this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.uploader', 'uploader')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.type = :type', { type: 'paper' })
            .andWhere('f.status = :status', { status: 'pending' })
            .orderBy('f.created_at', 'ASC')
            .getMany();
    }

    async findById(id: string): Promise<ProjectFile> {
        const file = await this.repo.findOne({ where: { id }, relations: ['project', 'uploader'] });
        if (!file) throw new NotFoundException('File not found');
        return file;
    }

    async moveFile(id: string, folderId: string | null): Promise<ProjectFile> {
        const file = await this.findById(id);
        file.folderId = folderId;
        return this.repo.save(file);
    }

    async create(data: {
        projectId: string;
        uploaderId: string;
        filename: string;
        originalName: string;
        fileSize: number;
        mimeType: string;
        type: string;
        category?: string;
        title?: string;
        description?: string;
        status?: string;
        folderId?: string | null;
    }): Promise<ProjectFile> {
        let version = 1;
        if (data.type === 'manual') {
            const max = await this.repo.createQueryBuilder('f')
                .select('MAX(f.version)', 'max')
                .where('f.project_id = :projectId AND f.type = :type', { projectId: data.projectId, type: 'manual' })
                .getRawOne();
            version = (max?.max ?? 0) + 1;
        }
        const entity = this.repo.create({ ...data, version, status: data.status ?? 'approved' });
        return this.repo.save(entity);
    }

    /** Return ids of all active users who can approve project files (manage_projects). */
    async findManagerIds(): Promise<string[]> {
        const users = await this.userRepo.find({ where: { isActive: true }, select: ['id', 'permissions'] });
        return users
            .filter((u) => effectivePermissions(u.permissions).manage_projects)
            .map((u) => u.id);
    }

    async findMyPendingFiles(uploaderId: string): Promise<ProjectFile[]> {
        return this.repo.createQueryBuilder('f')
            .leftJoinAndSelect('f.project', 'project')
            .where('f.uploader_id = :uploaderId', { uploaderId })
            .andWhere('f.status = :status', { status: 'pending' })
            .orderBy('f.created_at', 'DESC')
            .getMany();
    }

    async approve(id: string): Promise<ProjectFile> {
        const file = await this.findById(id);
        file.status = 'approved';
        const saved = await this.repo.save(file);
        // Mark all `file_pending` notifications for this file as read across all reviewers
        // so the "Needs Your Attention" strip is cleared system-wide immediately.
        await this.notificationsService.markReadByEntityId(id, 'file_pending');
        // Tell every connected dashboard to re-fetch pending counts.
        this.realtimeGateway.broadcastDashboardRefresh();
        return saved;
    }

    async delete(id: string): Promise<void> {
        const file = await this.findById(id);
        const docsPath = process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents');
        const filePath = path.join(docsPath, file.projectId, file.filename);
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore */ }
        await this.repo.delete(id);
    }

    getFilePath(file: ProjectFile): string {
        const docsPath = process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents');
        return path.join(docsPath, file.projectId, file.filename);
    }
}
