import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileFolder } from './file-folder.entity';
import { ProjectFile } from './project-file.entity';
import { Paper } from '../papers/paper.entity';
import * as fs from 'fs';
import * as path from 'path';

export interface CreateFolderDto {
    projectId: string;
    type: 'manual' | 'paper' | 'document';
    name: string;
    parentId?: string | null;
}

@Injectable()
export class FileFoldersService {
    constructor(
        @InjectRepository(FileFolder)
        private readonly folderRepo: Repository<FileFolder>,
        @InjectRepository(ProjectFile)
        private readonly fileRepo: Repository<ProjectFile>,
        @InjectRepository(Paper)
        private readonly paperRepo: Repository<Paper>,
    ) {}

    /* ── List immediate children ───────────────────────────── */
    async findChildren(
        projectId: string,
        type: 'manual' | 'paper' | 'document',
        parentId: string | null,
    ): Promise<FileFolder[]> {
        const qb = this.folderRepo.createQueryBuilder('f')
            .where('f.project_id = :projectId', { projectId })
            .andWhere('f.type = :type', { type });

        if (parentId) {
            qb.andWhere('f.parent_id = :parentId', { parentId });
        } else {
            qb.andWhere('f.parent_id IS NULL');
        }

        return qb.orderBy('f.name', 'ASC').getMany();
    }

    /* ── Breadcrumb path (root → current) ─────────────────── */
    async findPath(id: string): Promise<FileFolder[]> {
        const path: FileFolder[] = [];
        let current: FileFolder | null = await this.folderRepo.findOne({ where: { id } });
        while (current) {
            path.unshift(current);
            if (!current.parentId) break;
            current = await this.folderRepo.findOne({ where: { id: current.parentId } }) ?? null;
        }
        return path;
    }

    async findById(id: string): Promise<FileFolder> {
        const f = await this.folderRepo.findOne({ where: { id } });
        if (!f) throw new NotFoundException('Folder not found');
        return f;
    }

    /* ── Create ────────────────────────────────────────────── */
    async create(dto: CreateFolderDto, userId: string): Promise<FileFolder> {
        // Validate parent belongs to same project + type
        if (dto.parentId) {
            const parent = await this.findById(dto.parentId);
            if (parent.projectId !== dto.projectId || parent.type !== dto.type) {
                throw new ForbiddenException('Parent folder does not belong to this project/type');
            }
        }
        const folder = this.folderRepo.create({
            projectId: dto.projectId,
            parentId: dto.parentId ?? null,
            type: dto.type,
            name: dto.name.trim(),
            createdBy: userId,
        });
        return this.folderRepo.save(folder);
    }

    /* ── Rename ────────────────────────────────────────────── */
    async rename(id: string, name: string): Promise<FileFolder> {
        const folder = await this.findById(id);
        folder.name = name.trim();
        return this.folderRepo.save(folder);
    }

    /* ── Delete folder and ALL contents recursively (admin only) ── */
    async delete(id: string): Promise<void> {
        // BFS to collect root + all descendant folder IDs
        const allIds: string[] = [];
        const queue: string[] = [id];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            allIds.push(cur);
            const children = await this.folderRepo
                .createQueryBuilder('f')
                .select('f.id')
                .where('f.parent_id = :cur', { cur })
                .getMany();
            for (const c of children) queue.push(c.id);
        }

        // Delete all files (with disk cleanup) in each folder
        const docsPath = process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents');
        for (const folderId of allIds) {
            const files = await this.fileRepo
                .createQueryBuilder('f')
                .where('f.folder_id = :folderId', { folderId })
                .getMany();
            for (const file of files) {
                const fp = path.join(docsPath, file.projectId, file.filename);
                try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch { /* ignore */ }
            }
            if (files.length > 0) {
                await this.fileRepo.delete(files.map(f => f.id));
            }
        }

        // Delete folder records deepest-first (reverse of BFS) to satisfy FK constraints
        for (const folderId of [...allIds].reverse()) {
            await this.folderRepo.delete(folderId);
        }
    }

    /* ── Flat list of all folders in a project (for pickers) ─ */
    async findAll(projectId: string, type: 'manual' | 'paper' | 'document'): Promise<FileFolder[]> {
        return this.folderRepo.find({
            where: { projectId, type },
            order: { name: 'ASC' },
        });
    }
}
