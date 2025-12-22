import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminGuard } from 'src/auth/guards/admin.guard';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  // 🔹 Agent summary cards
  @Get('agent/summary')
  @UseGuards(JwtAuthGuard)
  getAgentSummary(@Req() req, @Query('days') days?: string) {
    const parsedDays =
      days === 'all' ? 0 : Number.isFinite(Number(days)) ? Number(days) : 7;

    return this.dashboardService.getAgentSummary(req.user.userId, parsedDays);
  }

  // 🔹 Agent bid graph
  @Get('agent/bids-graph')
  @UseGuards(JwtAuthGuard)
  getAgentBidGraph(@Req() req, @Query('days') days?: string) {
    const parsedDays =
      days === 'all' ? 0 : Number.isFinite(Number(days)) ? Number(days) : 7;

    return this.dashboardService.getAgentBidGraph(req.user.userId, parsedDays);
  }

  // 🔹 Admin summary cards
  @Get('admin/summary')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAdminSummary(@Query('days') days?: string) {
    const parsedDays =
      days === 'all' ? 0 : Number.isFinite(Number(days)) ? Number(days) : 7;

    return this.dashboardService.getAdminSummary(parsedDays);
  }

  // 🔹 Admin bid graph
  @Get('admin/bids-graph')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAdminBidGraph(@Query('days') days?: string) {
    const parsedDays =
      days === 'all' ? 0 : Number.isFinite(Number(days)) ? Number(days) : 7;

    return this.dashboardService.getAdminBidGraph(parsedDays);
  }

  @Get('admin/profit-trend')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getProfitTrend(@Query('days') days?: string) {
    const parsed =
      days === 'all' ? 0 : Number.isFinite(Number(days)) ? Number(days) : 7;

    return this.dashboardService.getAdminProfitTrend(parsed);
  }

  @Get('admin/top-agents')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getTopAgents(@Query('days') days?: string, @Query('limit') limit?: string) {
    const parsedDays =
      days === 'all' ? 0 : Number.isFinite(Number(days)) ? Number(days) : 7;

    const parsedLimit = Number.isFinite(Number(limit)) ? Number(limit) : 10;

    return this.dashboardService.getTopAgents(parsedDays, parsedLimit);
  }
}
