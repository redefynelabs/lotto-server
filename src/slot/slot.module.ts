import { Module } from '@nestjs/common';
import { SlotService } from './slot.service';
import { SlotController } from './slot.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsModule } from '../settings/settings.module';
import { SlotCronService } from './slot.cron.servcie';
import { BiddingModule } from '../bidding/bidding.module';

@Module({
  imports: [
    SettingsModule,
    BiddingModule,    
  ],
  controllers: [SlotController],
  providers: [
    SlotService,
    SlotCronService,
    PrismaService,
  ],
  exports: [SlotService],
})
export class SlotModule {}
