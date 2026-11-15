import {
    Controller, Get, Post, Delete, Param, Body, Query,
    UseGuards, Request, BadRequestException,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
    constructor(private readonly commentsService: CommentsService) {}

    /**
     * GET /comments?entityType=task&entityId=<uuid>
     * Returns all comments for the given entity, oldest-first.
     */
    @Get()
    findAll(
        @Query('entityType') entityType: string,
        @Query('entityId')   entityId: string,
    ) {
        if (!entityType || !entityId) {
            throw new BadRequestException('entityType and entityId are required');
        }
        return this.commentsService.findAll(entityType, entityId);
    }

    /** POST /comments — create a new comment or reply. */
    @Post()
    create(@Body() dto: CreateCommentDto, @Request() req) {
        return this.commentsService.create(dto, req.user);
    }

    /** DELETE /comments/:id — remove a comment (own or moderator). */
    @Delete(':id')
    remove(@Param('id') id: string, @Request() req) {
        return this.commentsService.remove(id, req.user);
    }
}
