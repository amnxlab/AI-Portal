import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

@Injectable()
export class AuditService {
    constructor(
        @InjectRepository(AuditLog)
        private readonly auditRepo: Repository<AuditLog>,
    ) { }

    async log(data: {
        actorId: string;
        entityType: string;
        entityId?: string;
        action: string;
        oldValue?: any;
        newValue?: any;
        ipAddress?: string;
    }) {
        await this.auditRepo.save(this.auditRepo.create(data));
    }

    async findByEntity(entityType: string, entityId: string) {
        return this.auditRepo.find({
            where: { entityType, entityId },
            order: { timestamp: 'DESC' },
            take: 100,
        });
    }
}
