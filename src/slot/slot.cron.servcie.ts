import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlotService } from './slot.service';

@Injectable()
export class SlotCronService {
  private readonly logger = new Logger(SlotCronService.name);

  constructor(private slotService: SlotService) {}

  // Runs every day at 00:00 AM
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailySlotGeneration() {
    this.logger.log('Running daily slot auto-generation...');

    await this.slotService.generateFutureSlots();

    this.logger.log('Daily slot generation completed');
  }
}
