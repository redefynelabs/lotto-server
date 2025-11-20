import { Module } from '@nestjs/common';
import { SlotService } from './slot.service';
import { SlotController } from './slot.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsModule } from '../settings/settings.module';
import { SlotCronService } from './slot.cron.servcie';

@Module({
  imports: [SettingsModule],
  controllers: [SlotController],
  providers: [SlotService, SlotCronService, PrismaService],
})
export class SlotModule {}
