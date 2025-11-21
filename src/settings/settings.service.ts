import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /** 
   * Always return the settings row.
   * If missing, auto-create default values.
   */
  async getSettings() {
    let settings = await this.prisma.appSettings.findFirst();

    if (!settings) {
      settings = await this.prisma.appSettings.create({
        data: {
          slotAutoGenerateCount: 7,

          defaultLdTimes: [], 
          defaultJpTimes: [],
          timezone:"",

          defaultCommissionPct: 0,
          agentNegativeBalanceLimt: 200,

          bidPrizeLD: 0,
          bidPrizeJP: 0,

          winningPrizeLD: 0,
          winningPrizeJP: 0,
        },
      });
    }

    return settings;
  }

  /**
   * Admin updates global app settings
   */
  async updateSettings(dto: UpdateSettingsDto) {
    const settings = await this.getSettings();

    return this.prisma.appSettings.update({
      where: { id: settings.id },
      data: dto,
    });
  }
}
