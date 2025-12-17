// results.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResultsService } from './results.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { Sse } from '@nestjs/common';
import { map } from 'rxjs/operators';
import { ResultStreamService } from './results-stream.service';

@Controller('results')
export class ResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly resultsStream: ResultStreamService,
  ) {}

  @Sse('stream')
  streamResults() {
    return this.resultsStream.stream$.pipe(map((data) => ({ data })));
  }

  @Get()
  async getAllResults(
    @Query('type') type?: 'LD' | 'JP',
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.resultsService.getAllResults(type, parsedLimit);
  }

  @Get('by-date')
  async getResultsByDate(@Query('date') date?: string) {
    return this.resultsService.getResultsByDate(date);
  }

  @Get('history-grouped')
  async getHistoryGrouped() {
    return this.resultsService.getHistoryGrouped();
  }

  /* ADMIN FULL REPORT FOR ALL SLOTS */
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAllAdminReports() {
    return this.resultsService.getAllAdminReports();
  }

  @Get('admin/by-date')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminResultsByDate(@Query('date') date?: string) {
    if (!date) {
      throw new BadRequestException(
        'Query parameter "date" (YYYY-MM-DD) is required',
      );
    }

    // Optional: Add basic date format validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    return this.resultsService.getAdminResultsByDate(date);
  }

  @Get('admin/range')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminResultsByRange(
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    // ParseIntPipe already returns undefined if no value or invalid
    // So days is now: number | undefined → perfect for our service

    if (days !== undefined && (isNaN(days) || days <= 0)) {
      throw new BadRequestException('days must be a positive number');
    }

    return this.resultsService.getAdminResultsByRange(days);
  }

  /* ADMIN REPORT FOR ONE SLOT */
  @Get('admin/report/:slotId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getAdminReport(@Param('slotId') slotId: string) {
    return this.resultsService.getAdminSlotResult(slotId);
  }

  /* BASIC RESULT BY SLOT */
  @Get(':slotId')
  async getResultBySlotId(@Param('slotId') slotId: string) {
    return this.resultsService.getResultBySlotId(slotId);
  }
}
