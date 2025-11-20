import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { AdminUpdateSlotSettingsDto } from './dto/admin-update-slot-settings.dto';
import { SlotType, SlotStatus } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { generateSlotId } from '../utils/generate-slot-id.util';

@Injectable()
export class SlotService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  // ======================================================
  // Create slot using settings
  // ======================================================
  async createSlot(dto: CreateSlotDto) {
    const settings = await this.settingsService.getSettings();

    const nextIndex = await this.getNextSlotNumber(dto.type);
    const uniqueSlotId = generateSlotId(dto.type, nextIndex);

    const slotTime = new Date(dto.slotTime);
    const windowCloseAt = new Date(slotTime.getTime() - 15 * 60 * 1000);

    const pricing =
      dto.type === SlotType.LD
        ? {
            bidPrize: settings.bidPrizeLD,
            winningPrize: settings.winningPrizeLD,
          }
        : {
            bidPrize: settings.bidPrizeJP,
            winningPrize: settings.winningPrizeJP,
          };

    return this.prisma.slot.create({
      data: {
        type: dto.type,
        uniqueSlotId,
        slotTime,
        windowCloseAt,
        settingsJson: {
          ...pricing,
          ...(dto.settingsJson || {}),
        },
      },
    });
  }

  // ======================================================
  // Unique ID generator (LD0001, JP0001, etc.)
  // ======================================================
  async getNextSlotNumber(type: SlotType) {
    const prefix = type === SlotType.LD ? 'LD' : 'JP';

    const last = await this.prisma.slot.findFirst({
      where: { type },
      orderBy: { createdAt: 'desc' },
    });

    if (!last || !last.uniqueSlotId.startsWith(prefix)) return 1;

    return parseInt(last.uniqueSlotId.replace(prefix, ''), 10) + 1;
  }

  // ======================================================
  // Admin slot update
  // ======================================================
  async updateSlot(slotId: string, dto: AdminUpdateSlotSettingsDto) {
    const existing = await this.prisma.slot.findUnique({
      where: { id: slotId },
    });

    if (!existing) throw new BadRequestException('Slot not found');

    let windowCloseAt = existing.windowCloseAt;

    if (dto.slotTime) {
      const newTime = new Date(dto.slotTime);
      windowCloseAt = new Date(newTime.getTime() - 15 * 60 * 1000);
    }

    return this.prisma.slot.update({
      where: { id: slotId },
      data: {
        slotTime: dto.slotTime ? new Date(dto.slotTime) : undefined,
        windowCloseAt,
        status: dto.status,
        settingsJson: dto.settingsJson
          ? { ...(existing.settingsJson as object), ...(dto.settingsJson as object) }
          : undefined,
      },
    });
  }

  // ======================================================
  // Rolling slot generation logic (always keep next 7 days)
  // ======================================================
  async generateFutureSlots() {
    const settings = await this.settingsService.getSettings();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = await this.prisma.slot.findMany({
      where: { slotTime: { gt: today } },
    });

    const uniqueDays = new Set(
      upcoming.map((s) => {
        const d = new Date(s.slotTime);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      }),
    );

    const count = uniqueDays.size;
    const needed = 7 - count;

    if (needed <= 0) {
      return { message: 'Already have 7 days of slots' };
    }

    let lastDay = [...uniqueDays]
      .map((t) => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime())
      .pop();

    if (!lastDay) lastDay = new Date(today);

    for (let i = 1; i <= needed; i++) {
      const nextDay = new Date(lastDay);
      nextDay.setDate(lastDay.getDate() + i);
      nextDay.setHours(0, 0, 0, 0);

      await this.generateSlotsForDay(nextDay, settings);
    }

    return { message: 'Upcoming rolling slots updated' };
  }

  // ======================================================
  // Generate all slots for a single day
  // ======================================================
  private async generateSlotsForDay(date: Date, settings: any) {
    for (const t of settings.defaultLdTimes) {
      await this.createTimedSlot(SlotType.LD, date, t);
    }

    for (const t of settings.defaultJpTimes) {
      await this.createTimedSlot(SlotType.JP, date, t);
    }
  }

  // ======================================================
  // Create a slot using date + time
  // ======================================================
  private async createTimedSlot(type: SlotType, date: Date, time: string) {
    const [h, m] = time.split(':').map(Number);
    const slotTime = new Date(date);
    slotTime.setHours(h, m, 0, 0);

    const exists = await this.prisma.slot.findFirst({
      where: { type, slotTime },
    });

    if (exists) return;

    await this.createSlot({
      type,
      slotTime: slotTime.toISOString(),
    });
  }

  // ======================================================
  // Public: get all open upcoming slots
  // ======================================================
  async getActiveSlots() {
    return this.prisma.slot.findMany({
      where: {
        status: SlotStatus.OPEN,
        slotTime: { gte: new Date() },
      },
      orderBy: { slotTime: 'asc' },
    });
  }
}
