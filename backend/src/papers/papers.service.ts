import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paper } from './paper.entity';
import { PaperFile } from './paper-file.entity';
import { ProjectsService } from '../projects/projects.service';
import { AuditService } from '../audit/audit.service';
import { effectivePermissions } from '../roles/role.entity';
import { CreatePaperDto } from './dto/create-paper.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';

@Injectable()
export class PapersService {
    constructor(
        @InjectRepository(Paper)
        private readonly paperRepo: Repository<Paper>,
        @InjectRepository(PaperFile)
        private readonly paperFileRepo: Repository<PaperFile>,
        private readonly projectsService: ProjectsService,
        private readonly auditService: AuditService,
    ) {}

    /* ── Queries ───────────────────────────────────────────── */

    async findAll(filters: {
        projectId?: string;
        tags?: string[];
        search?: string;
        folderId?: string | null;
        allowedProjectIds?: string[];
    }): Promise<Paper[]> {
        const qb = this.paperRepo.createQueryBuilder('p')
            .leftJoinAndSelect('p.project', 'project')
            .leftJoinAndSelect('p.addedByUser', 'addedByUser')
            .leftJoinAndSelect('p.files', 'files')
            .leftJoinAndSelect('files.file', 'linkedFile');

        // Restrict to user's accessible projects when not Admin
        if (filters.allowedProjectIds !== undefined) {
            if (filters.allowedProjectIds.length === 0) return [];
            qb.andWhere('p.project_id IN (:...allowedProjectIds)', { allowedProjectIds: filters.allowedProjectIds });
        }

        if (filters.projectId) {
            qb.andWhere('p.project_id = :projectId', { projectId: filters.projectId });
        }

        if (filters.tags?.length) {
            qb.andWhere('p.tags @> :tags::jsonb', { tags: JSON.stringify(filters.tags) });
        }

        if (filters.search) {
            qb.andWhere(
                '(p.title ILIKE :q OR p.authors ILIKE :q OR p.abstract ILIKE :q OR p.venue ILIKE :q)',
                { q: `%${filters.search}%` },
            );
        }

        // folderId filter: null = root items only; undefined = all items
        if (filters.folderId !== undefined) {
            if (filters.folderId === null) {
                qb.andWhere('p.folder_id IS NULL');
            } else {
                qb.andWhere('p.folder_id = :folderId', { folderId: filters.folderId });
            }
        }

        return qb.orderBy('p.created_at', 'DESC').getMany();
    }

    async findById(id: string): Promise<Paper> {
        const paper = await this.paperRepo.findOne({
            where: { id },
            relations: ['project', 'addedByUser'],
        });
        if (!paper) throw new NotFoundException('Paper not found');
        return paper;
    }

    async findFilesForPaper(paperId: string): Promise<PaperFile[]> {
        return this.paperFileRepo.find({
            where: { paperId },
            relations: ['file'],
            order: { createdAt: 'ASC' },
        });
    }

    async getAllTags(allowedProjectIds?: string[]): Promise<string[]> {
        const qb = this.paperRepo
            .createQueryBuilder('p')
            .select('DISTINCT jsonb_array_elements_text(p.tags)', 'tag')
            .where("p.tags != '[]'::jsonb");
        if (allowedProjectIds !== undefined) {
            if (allowedProjectIds.length === 0) return [];
            qb.andWhere('p.project_id IN (:...allowedProjectIds)', { allowedProjectIds });
        }
        return (await qb.orderBy('tag', 'ASC').getRawMany()).map((r) => r.tag);
    }

    /* ── Commands ──────────────────────────────────────────── */

    async movePaper(id: string, folderId: string | null): Promise<Paper> {
        const paper = await this.findById(id);
        paper.folderId = folderId;
        await this.paperRepo.save(paper);
        return this.findById(id);
    }

    async create(dto: CreatePaperDto, userId: string): Promise<Paper> {
        const paper = this.paperRepo.create({ ...dto, addedBy: userId });
        const saved = await this.paperRepo.save(paper);

        await this.auditService.log({
            actorId: userId,
            entityType: 'paper',
            entityId: saved.id,
            action: 'paper_created',
            newValue: { title: saved.title, projectId: saved.projectId },
        });

        return this.findById(saved.id);
    }

    async update(id: string, dto: UpdatePaperDto, userId: string): Promise<Paper> {
        const paper = await this.findById(id);
        const oldValue = { title: paper.title };

        Object.assign(paper, dto);
        await this.paperRepo.save(paper);

        await this.auditService.log({
            actorId: userId,
            entityType: 'paper',
            entityId: id,
            action: 'paper_updated',
            oldValue,
            newValue: dto,
        });

        return this.findById(id);
    }

    async remove(id: string, userId: string): Promise<void> {
        const paper = await this.findById(id);

        await this.auditService.log({
            actorId: userId,
            entityType: 'paper',
            entityId: id,
            action: 'paper_deleted',
            oldValue: { title: paper.title, projectId: paper.projectId },
        });

        await this.paperRepo.delete(id);
    }

    /* ── File linking ─────────────────────────────────────── */

    async linkFile(paperId: string, fileId: string, fileType: string, userId: string): Promise<PaperFile> {
        await this.findById(paperId); // ensure paper exists

        const link = this.paperFileRepo.create({ paperId, fileId, fileType });
        const saved = await this.paperFileRepo.save(link);

        await this.auditService.log({
            actorId: userId,
            entityType: 'paper',
            entityId: paperId,
            action: 'paper_file_linked',
            newValue: { fileId, fileType },
        });

        return this.paperFileRepo.findOneOrFail({
            where: { id: saved.id },
            relations: ['file'],
        });
    }

    async unlinkFile(paperId: string, linkId: string, userId: string): Promise<void> {
        const link = await this.paperFileRepo.findOne({ where: { id: linkId, paperId } });
        if (!link) throw new NotFoundException('Paper-file link not found');

        await this.auditService.log({
            actorId: userId,
            entityType: 'paper',
            entityId: paperId,
            action: 'paper_file_unlinked',
            oldValue: { fileId: link.fileId, fileType: link.fileType },
        });

        await this.paperFileRepo.delete(linkId);
    }

    /* ── Access control helpers ────────────────────────────── */

    /**
     * Resolves a paper for a reader.
     *
     * It used to require project membership, which is the assignment model
     * the lab has cancelled: every signed-in user may read any project, so
     * there is nothing left to check beyond the paper existing. The name is
     * kept because several callers use it; `canModify` below is what still
     * decides who may change anything.
     */
    async assertProjectMember(paperId: string, _userId: string, _userPerms?: any): Promise<Paper> {
        return this.findById(paperId);
    }

    async canModify(paper: Paper, userId: string, userPerms?: any): Promise<boolean> {
        const perms = effectivePermissions(userPerms);
        if (perms.manage_projects) return true;
        return paper.addedBy === userId;
    }
}
