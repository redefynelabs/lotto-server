import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { AdminUpdateSlotSettingsDto } from './dto/admin-update-slot-settings.dto';
import { SlotType, SlotStatus } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { generateSlotId } from '../utils/generate-slot-id.util';
import { getMalaysiaDate, MYT, toUTCDate } from 'src/utils/timezone.util';
import { DateTime } from 'luxon';

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
          ? {
              ...(existing.settingsJson as object),
              ...(dto.settingsJson as object),
            }
          : undefined,
      },
    });
  }

  // ======================================================
  // Rolling slot generation logic (always keep next 7 days)
  // ======================================================
  // ======================================================
  // Rolling slot generation: Always keep exactly 7 days of OPEN slots
  // ======================================================
  async generateFutureSlots() {
    const settings = await this.settingsService.getSettings();

    const nowMYT = getMalaysiaDate();
    const todayMidnightMYT = nowMYT.startOf('day');

    // Find how many future OPEN days we have (in Malaysia time)
    const upcomingOpenSlots = await this.prisma.slot.findMany({
      where: {
        status: SlotStatus.OPEN,
        slotTime: { gt: new Date() },
      },
      orderBy: { slotTime: 'asc' },
    });

    const openMalaysiaDates = new Set<string>();
    for (const slot of upcomingOpenSlots) {
      const myt = getMalaysiaDate(slot.slotTime);
      openMalaysiaDates.add(myt.toISODate()!); // YYYY-MM-DD
    }

    const neededDays = 7 - openMalaysiaDates.size;
    if (neededDays <= 0) {
      return { message: 'Already have 7 days of open slots (Malaysia time)' };
    }

    // Start generating from the next missing Malaysia day
    let currentDay =
      openMalaysiaDates.size > 0
        ? DateTime.fromISO([...openMalaysiaDates].sort().pop()!, {
            zone: MYT,
          }).plus({ days: 1 })
        : todayMidnightMYT.plus({ days: 1 }); // tomorrow

    for (let i = 0; i < neededDays; i++) {
      const nextDay = currentDay.plus({ days: i });
      await this.generateSlotsForDay(nextDay.toJSDate(), settings);
    }

    return {
      message: `Generated ${neededDays} new days. Now have 7 open days in Malaysia time.`,
    };
  }

  // ======================================================
  // Generate all slots for a single day
  // ======================================================
  private async generateSlotsForDay(malaysiaDate: Date, settings: any) {
    // LD Slots
    for (const t of settings.defaultLdTimes) {
      await this.createTimedSlot(SlotType.LD, malaysiaDate, t);
    }

    // JP Jackpot – only one per day
    for (const t of settings.defaultJpTimes) {
      await this.createTimedSlot(SlotType.JP, malaysiaDate, t);
    }
  }
  // ======================================================
  // Create a slot using date + time
  // ======================================================
  private async createTimedSlot(
    type: SlotType,
    malaysiaDate: Date,
    time: string,
  ) {
    const [h, m] = time.split(':').map(Number);

    // Build the full Malaysia datetime
    const mytDateTime = getMalaysiaDate(malaysiaDate).set({
      hour: h,
      minute: m,
      second: 0,
      millisecond: 0,
    });

    const slotTimeUTC = toUTCDate(mytDateTime);

    // Check if already exists
    const exists = await this.prisma.slot.findFirst({
      where: {
        type,
        slotTime: slotTimeUTC,
      },
    });

    if (exists) return;

    await this.createSlot({
      type,
      slotTime: slotTimeUTC.toISOString(),
    });
  }

  // Auto-close expired slots (called by cron)
  async closeExpiredSlots() {
    const now = new Date();

    const result = await this.prisma.slot.updateMany({
      where: {
        status: SlotStatus.OPEN,
        windowCloseAt: { lte: now },
      },
      data: {
        status: SlotStatus.CLOSED,
      },
    });

    return result;
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
