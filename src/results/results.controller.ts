import { Controller, Get, Param, Query } from '@nestjs/common';
import { ResultsService } from './results.service';

@Controller('results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

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

  @Get(':slotId')
  async getResultBySlotId(@Param('slotId') slotId: string) {
    return this.resultsService.getResultBySlotId(slotId);
  }

  @Get('history-grouped')
  async getHistoryGrouped() {
    return this.resultsService.getHistoryGrouped();
  }
}
