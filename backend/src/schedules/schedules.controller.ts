import { Controller, Post, Get, Delete, Patch, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException, HttpCode } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchedulesService } from './schedules.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { IsString, IsArray, IsOptional, ValidateNested, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class ShiftDto {
    @IsString() day: string;
    @IsString() start: string;
    @IsString() end: string;
    @IsString() @IsOptional() note?: string;
}

class SubmitScheduleDto {
    @IsDateString() weekStart: string;
    @IsArray() @ValidateNested({ each: true }) @Type(() => ShiftDto) shifts: ShiftDto[];
    @IsString() @IsOptional() notes?: string;
}

class ReviewScheduleDto {
    @IsIn(['approve', 'deny', 'revision']) action: 'approve' | 'deny' | 'revision';
    @IsString() @IsOptional() note?: string;
}

@Controller('schedules')
@UseGuards(JwtAuthGuard)
export class SchedulesController {
    constructor(private readonly schedulesService: SchedulesService) { }

    @Post()
    submit(@Request() req, @Body() dto: SubmitScheduleDto) {
        return this.schedulesService.submit(req.user.id, dto.weekStart, dto.shifts, dto.notes);
    }

    @Get('mine')
    findMine(@Request() req) {
        return this.schedulesService.findMySchedules(req.user.id);
    }

    @Get()
    @UseGuards(RolesGuard)
    @Permissions('view_all_schedules')
    findByWeek(@Query('week') week: string) {
        return this.schedulesService.findByWeek(week);
    }

    @Post('post-discord/:weekStart')
    @UseGuards(RolesGuard)
    @Permissions('post_discord')
    postDiscord(@Param('weekStart') weekStart: string) {
        return this.schedulesService.postToDiscord(weekStart);
    }

    @Post('post-discord-image/:weekStart')
    @UseGuards(RolesGuard)
    @Permissions('post_discord')
    @UseInterceptors(FileInterceptor('image', { storage: undefined })) // memory storage
    postDiscordImage(
        @Param('weekStart') weekStart: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('No image uploaded');
        return this.schedulesService.postToDiscordImage(weekStart, file.buffer);
    }

    @Patch(':id/review')
    @UseGuards(RolesGuard)
    @Permissions('manage_schedules')
    review(
        @Param('id') id: string,
        @Request() req,
        @Body() dto: ReviewScheduleDto,
    ) {
        return this.schedulesService.review(id, req.user.id, dto.action, dto.note);
    }

    @Delete(':id')
    @UseGuards(RolesGuard)
    @Permissions('manage_schedules')
    @HttpCode(204)
    deleteSchedule(@Param('id') id: string) {
        return this.schedulesService.deleteSchedule(id);
    }
}
