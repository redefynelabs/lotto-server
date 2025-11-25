import { Injectable, Logger } from '@nestjs/common';
import { Cron, Timeout } from '@nestjs/schedule';
import { SlotService } from './slot.service';

@Injectable()
export class SlotCronService {
  private readonly logger = new Logger(SlotCronService.name);

  constructor(private readonly slotService: SlotService) {}

  // 1. Auto-close slots when bidding window ends (every minute)
  @Cron('0 * * * * *', {
    name: 'close-expired-slots-every-minute',
    timeZone: 'UTC',
  })
  async handleSlotAutoClosing() {
    try {
      const result = await this.slotService.closeExpiredSlots();
      if (result?.count > 0) {
        this.logger.log(`Auto-closed ${result.count} expired slot(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to auto-close expired slots', error.stack ?? error);
    }
  }

  // 2. Auto-announce results for closed slots where admin didn't pick (every minute)
  @Cron('30 * * * * *', {
    name: 'auto-announce-closed-slots-every-minute',
    timeZone: 'UTC',
  })
  async handleAutoAnnounce() {
    try {
      const processed = await this.slotService.autoAnnounceResultsForClosedSlots();
      if (processed && processed.length > 0) {
        this.logger.log(`Auto-announced ${processed.length} slot(s): ${processed.join(', ')}`);
      }
    } catch (error) {
      this.logger.error('Auto-announce cron failed', error.stack ?? error);
    }
  }

  // 3. Generate future slots every day at 00:05 AM Malaysia Time
  @Cron('0 5 0 * * *', {
    name: 'generate-future-slots-malaysia',
    timeZone: 'Asia/Kuala_Lumpur',
  })
  async handleDailySlotGeneration() {
    this.logger.log('Malaysia 00:05 AM - Starting daily slot generation (rolling)');

    try {
      const result = await this.slotService.generateFutureSlots();
      this.logger.log(result.message || 'Daily slot generation completed');
    } catch (error) {
      this.logger.error('Failed to generate future slots', error.stack ?? error);
    }
  }

  // 4. Run once on app startup
  @Timeout(10_000) // 10 seconds after startup
  async runStartupTasks() {
    this.logger.log('App started - Running startup slot maintenance...');

    try {
      // Close any slots that should’ve been closed while server was down
      await this.handleSlotAutoClosing();

      // Ensure future slots exist
      await this.handleDailySlotGeneration();

      // Try auto-announce in case any closed slots missed
      await this.handleAutoAnnounce();

      this.logger.log('Startup slot maintenance completed successfully');
    } catch (error) {
      this.logger.error('Startup slot tasks failed', error.stack ?? error);
    }
  }
}
