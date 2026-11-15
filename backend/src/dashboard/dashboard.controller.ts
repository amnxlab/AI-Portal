import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
    constructor(private readonly dashboardService: DashboardService) { }

    @Get('summary')
    summary(@Request() req) { return this.dashboardService.getSummary(req.user); }

    @Get('my')
    personal(@Request() req) { return this.dashboardService.getPersonalDashboard(req.user.id); }

    @Get('activity')
    activity(@Request() req) { return this.dashboardService.getActivityFeed(req.user.id, req.user.permissions); }

    @Get('gantt')
    gantt(@Query('projectId') projectId?: string) { return this.dashboardService.getGanttData(projectId); }

    @Get('team-timeline')
    teamTimeline() { return this.dashboardService.getTeamTimeline(); }

    @Get('project-timeline')
    projectTimeline(@Request() req) { return this.dashboardService.getProjectTimeline(req.user); }

    @Get('analytics')
    analytics(@Query('weeks') weeks?: string) {
        return this.dashboardService.getAnalytics(weeks ? parseInt(weeks, 10) : 4);
    }

    @Get('leaderboard')
    leaderboard() { return this.dashboardService.getLeaderboard(); }
}
