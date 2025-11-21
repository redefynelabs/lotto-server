import { Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { SlotService } from './slot.service';

@Injectable()
export class SlotCronService {
  private readonly logger = new Logger(SlotCronService.name);

  constructor(private readonly slotService: SlotService) {}

  // 1. Auto-close slots when bidding window ends (every minute)
  // Runs in UTC but closes based on windowCloseAt (which is already in UTC)
  @Cron('0 * * * * *', {
    name: 'close-expired-slots-every-minute',
    timeZone: 'UTC', // Keep cron in UTC — it's more reliable globally
  })
  async handleSlotAutoClosing() {
    try {
      const result = await this.slotService.closeExpiredSlots();
      if (result?.count > 0) {
        this.logger.log(`Auto-closed ${result.count} expired slot(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to auto-close expired slots', error.stack);
    }
  }

  // 2. Generate future slots every day at 00:05 AM Malaysia Time
  // This ensures midnight slots (00:00 & 00:15) are already generated
  @Cron('0 5 0 * * *', {
    name: 'generate-future-slots-malaysia',
    timeZone: 'Asia/Kuala_Lumpur', // Critical: Runs at 00:05 AM Malaysia time
  })
  async handleDailySlotGeneration() {
    this.logger.log('Malaysia 00:05 AM - Starting daily slot generation (7-day rolling)');

    try {
      const result = await this.slotService.generateFutureSlots();
      this.logger.log(result.message || 'Daily slot generation completed');
    } catch (error) {
      this.logger.error('Failed to generate future slots', error.stack);
    }
  }

  // 3. Run once on app startup (critical for reliability)
  @Timeout(10_000) // 10 seconds after startup
  async runStartupTasks() {
    this.logger.log('App started - Running startup slot maintenance...');

    try {
      // Close any slots that should’ve been closed while server was down
      await this.handleSlotAutoClosing();

      // Ensure we have 7 days of open slots right now
      await this.handleDailySlotGeneration();

      this.logger.log('Startup slot maintenance completed successfully');
    } catch (error) {
      this.logger.error('Startup slot tasks failed', error.stack);
    }
  }
}