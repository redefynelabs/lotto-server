import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(SlotService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  // -------------------------
  // Create slot using settings
  // -------------------------
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

    // create - assume uniqueSlotId or unique constraint prevents exact duplicates
    return this.prisma.slot.create({
      data: {
        type: dto.type,
        uniqueSlotId,
        slotTime,
        windowCloseAt,
        status: SlotStatus.OPEN,
        settingsJson: {
          ...pricing,
          ...(dto.settingsJson || {}),
        },
      },
    });
  }

  // -------------------------
  // Unique ID generator (LD0001, JP0001, etc.)
  // -------------------------
  async getNextSlotNumber(type: SlotType) {
    const prefix = type === SlotType.LD ? 'LD' : 'JP';

    const last = await this.prisma.slot.findFirst({
      where: { type },
      orderBy: { createdAt: 'desc' },
      select: { uniqueSlotId: true },
    });

    if (!last || !last.uniqueSlotId?.startsWith(prefix)) return 1;

    const num = parseInt(last.uniqueSlotId.replace(prefix, ''), 10);
    return Number.isNaN(num) ? 1 : num + 1;
  }

  // -------------------------
  // Admin slot update
  // -------------------------
  async updateSlot(slotId: string, dto: AdminUpdateSlotSettingsDto) {
    const existing = await this.prisma.slot.findUnique({
      where: { id: slotId },
    });

    if (!existing) throw new BadRequestException('Slot not found');

    // ⭐ BLOCK EDIT IF BIDS ALREADY EXIST
    const hasBids = await this.prisma.bid.count({
      where: { slotId },
    });

    if (hasBids > 0) {
      throw new BadRequestException(
        'Cannot modify this slot because bids already exist.',
      );
    }

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

  // -------------------------
  // Rolling slot generation: ensure next 7 days exist (idempotent)
  // -------------------------
  async generateFutureSlots() {
    const settings = await this.settingsService.getSettings();

    const daysToGenerate = settings.slotAutoGenerateCount; // ⭐ dynamic count

    if (!daysToGenerate || daysToGenerate <= 0) {
      throw new BadRequestException(
        'slotAutoGenerateCount must be greater than 0',
      );
    }

    const nowMYT = getMalaysiaDate();
    const todayMidnightMYT = nowMYT.startOf('day');

    // Target: next N days (tomorrow .. tomorrow + (count - 1))
    const targetDays: DateTime[] = [];
    for (let d = 1; d <= daysToGenerate; d++) {
      targetDays.push(todayMidnightMYT.plus({ days: d }));
    }

    let createdCount = 0;

    for (const dt of targetDays) {
      const created = await this.ensureAllTimesExistForDay(
        dt.toJSDate(),
        settings,
      );
      createdCount += created;
    }

    return {
      message: `Ensured ${daysToGenerate} days of slots (created ${createdCount} missing slots).`,
      createdCount,
      daysGenerated: daysToGenerate,
    };
  }

  // Ensure all required times exist for a Malaysia date (idempotent)
  private async ensureAllTimesExistForDay(malaysiaDate: Date, settings: any) {
    // Start and end of that Malaysia day in UTC
    const dayStartMYT = getMalaysiaDate(malaysiaDate).startOf('day'); // DateTime in MYT
    const dayEndMYT = dayStartMYT.endOf('day');

    const dayStartUTC = toUTCDate(dayStartMYT).toISOString();
    const dayEndUTC = toUTCDate(dayEndMYT).toISOString();

    // Fetch existing slots within that UTC window
    const existing = await this.prisma.slot.findMany({
      where: {
        slotTime: {
          gte: new Date(dayStartUTC),
          lte: new Date(dayEndUTC),
        },
      },
      select: { type: true, slotTime: true },
    });

    const existingTimesByType = {
      [SlotType.LD]: new Set<string>(),
      [SlotType.JP]: new Set<string>(),
    };

    for (const s of existing) {
      const myt = getMalaysiaDate(s.slotTime);
      existingTimesByType[s.type].add(myt.toFormat('HH:mm'));
    }

    let created = 0;

    // Create missing LD times
    for (const t of settings.defaultLdTimes) {
      if (!existingTimesByType[SlotType.LD].has(t)) {
        await this.createTimedSlot(SlotType.LD, malaysiaDate, t);
        created++;
      }
    }

    // Create missing JP times
    for (const t of settings.defaultJpTimes) {
      if (!existingTimesByType[SlotType.JP].has(t)) {
        await this.createTimedSlot(SlotType.JP, malaysiaDate, t);
        created++;
      }
    }

    return created;
  }

  // Create slot for given Malaysia date + time (idempotent because createSlot checks exists)
  private async createTimedSlot(
    type: SlotType,
    malaysiaDate: Date,
    time: string,
  ) {
    const [h, m] = time.split(':').map(Number);

    // Build the full Malaysia datetime using luxon
    const mytDateTime = getMalaysiaDate(malaysiaDate).set({
      hour: h,
      minute: m,
      second: 0,
      millisecond: 0,
    });

    // convert to UTC Date for DB storage
    const slotTimeUTC = toUTCDate(mytDateTime); // should return luxon DateTime or Date - adapt below

    // Normalize slotTime as JS Date for prisma
    const slotTimeJs =
      slotTimeUTC instanceof Date
        ? slotTimeUTC
        : (slotTimeUTC as any).toJSDate();

    // Check if exists already
    const exists = await this.prisma.slot.findFirst({
      where: {
        type,
        slotTime: slotTimeJs,
      },
    });

    if (exists) return;

    // createSlot expects ISO string
    await this.createSlot({
      type,
      slotTime: slotTimeJs.toISOString(),
    });
  }

  // -------------------------
  // Auto-close expired slots (called by cron)
  // -------------------------
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

    // If any slots were closed, ensure we still have 7 days of future slots
    if (result.count > 0) {
      try {
        await this.generateFutureSlots();
      } catch (err) {
        this.logger.error('Failed to generate future slots after closing', err);
      }
    }

    return result;
  }

  async getSlotsGroupedByMalaysiaDate() {
    const slots = await this.prisma.slot.findMany({
      orderBy: { slotTime: 'asc' },
    });

    const result: Record<string, any[]> = {};

    for (const s of slots) {
      // convert UTC → MYT
      const myt = getMalaysiaDate(s.slotTime);

      // Extract Malaysia date (YYYY-MM-DD)
      const dateKey = myt.toFormat('yyyy-MM-dd');

      if (!result[dateKey]) result[dateKey] = [];
      result[dateKey].push({
        ...s,
        slotTimeMYT: myt.toISO(), // optional: return MYT time to frontend
        slotTimeFormatted: myt.toFormat('HH:mm'),
      });
    }

    return result;
  }

  // -------------------------
  // Public: get all slots
  // -------------------------
  async getAllSlots() {
    return this.prisma.slot.findMany({
      orderBy: { slotTime: 'asc' },
    });
  }

  // -------------------------
  // Public: get all open upcoming slots
  // -------------------------
  async getActiveSlots() {
    return this.prisma.slot.findMany({
      where: {
        status: SlotStatus.OPEN,
        slotTime: { gte: new Date() },
      },
      orderBy: { slotTime: 'asc' },
    });
  }

  // -------------------------
  // Get only ACTIVE LD slots
  // -------------------------
  async getActiveLdSlots() {
    return this.prisma.slot.findMany({
      where: {
        type: SlotType.LD,
        status: SlotStatus.OPEN,
        slotTime: { gte: new Date() },
      },
      orderBy: { slotTime: 'asc' },
    });
  }

  // -------------------------
  // Get only ACTIVE JP slots
  // -------------------------
  async getActiveJpSlots() {
    return this.prisma.slot.findMany({
      where: {
        type: SlotType.JP,
        status: SlotStatus.OPEN,
        slotTime: { gte: new Date() },
      },
      orderBy: { slotTime: 'asc' },
    });
  }
}
