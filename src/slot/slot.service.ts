import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { AdminUpdateSlotSettingsDto } from './dto/admin-update-slot-settings.dto';
import { SlotType, SlotStatus } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { generateSlotId } from '../utils/generate-slot-id.util';
import { getMalaysiaDate, MYT, toUTCDate } from 'src/utils/timezone.util';
import { DateTime } from 'luxon';
import { BiddingService } from 'src/bidding/bidding.service';

@Injectable()
export class SlotService {
  private readonly logger = new Logger(SlotService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
    private biddingService: BiddingService,
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

    const setting =
      dto.type === SlotType.LD
        ? {
            bidPrize: settings.bidPrizeLD,
            winningPrize: settings.winningPrizeLD,
            minProfitPct: settings.minProfitPct,
          }
        : {
            bidPrize: settings.bidPrizeJP,
            winningPrize: settings.winningPrizeJP,
            minProfitPct: settings.minProfitPct,
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
          ...setting,
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
    const slots = await this.prisma.slot.findMany({
      orderBy: { slotTime: 'asc' },
      include: {
        bids: true, // We need all bids to calculate totals
      },
    });

    return slots.map((slot) => {
      let totalUnits = 0;

      if (slot.type === 'LD') {
        // LD: add the count field
        totalUnits = slot.bids.reduce((sum, b) => sum + b.count, 0);
      } else {
        // JP: each bid has jpNumbers (array)
        // You decide rule → here 1 bid = 1 unit
        totalUnits = slot.bids.length;
      }

      return {
        ...slot,
        totalUnits,
      };
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

  /**
   * Auto-announce results for closed slots where admin didn't pick a result.
   * Returns array of slot ids that were auto-announced.
   */
  async autoAnnounceResultsForClosedSlots(): Promise<string[]> {
    const now = new Date();

    // Find slots that are CLOSED, whose slotTime <= now (result time passed),
    // and that do not have a drawResult yet.
    const closedSlots = await this.prisma.slot.findMany({
      where: {
        status: SlotStatus.CLOSED,
        slotTime: { lte: now },
      },
      orderBy: { slotTime: 'asc' },
    });

    const processedSlots: string[] = [];

    for (const slot of closedSlots) {
      // skip if already has draw result
      const existingDraw = await this.prisma.drawResult.findUnique({
        where: { slotId: slot.id },
      });
      if (existingDraw) continue;

      try {
        this.logger.log(
          `Auto-announcing slot ${slot.id} (${slot.type} ${slot.slotTime.toISOString()})`,
        );

        if (slot.type === SlotType.LD) {
          await this.autoAnnounceLD(slot.id);
        } else {
          await this.autoAnnounceJP(slot.id);
        }

        processedSlots.push(slot.id);
      } catch (err) {
        this.logger.error(
          `Failed to auto-announce slot ${slot.id}`,
          err.stack ?? err,
        );
        // continue with other slots
      }
    }

    return processedSlots;
  }

  // ---------
  // AUTO ANNOUNCE LD
  // ---------
  private async autoAnnounceLD(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      select: { settingsJson: true, type: true },
    });

    if (!slot) throw new BadRequestException('Slot not found');

    const settings = (slot.settingsJson as Record<string, any>) || {};

    const W = Number(settings.winningPrize ?? 0);
    const minProfitPct = Number(settings.minProfitPct ?? 0.15);
    const maxBidLimitPerNumber = Number(settings.ldBidLimitPerNumber ?? 120);

    // total collected
    const aggCollected = await this.prisma.bid.aggregate({
      where: { slotId },
      _sum: { amount: true },
    });

    const C = aggCollected._sum?.amount ? Number(aggCollected._sum.amount) : 0;
    const M = Number((C - C * minProfitPct).toFixed(2));

    // units per number
    const perNumber = await this.prisma.bid.groupBy({
      by: ['number'],
      where: { slotId },
      _sum: { count: true },
    });

    const unitsMap = new Map<number, number>();
    for (const r of perNumber) {
      unitsMap.set(Number(r.number), Number(r._sum?.count ?? 0));
    }

    // ensure 1..37 present
    for (let n = 1; n <= 37; n++) {
      if (!unitsMap.has(n)) unitsMap.set(n, 0);
    }

    // STEP 1: sort by unit ASC
    let sorted = [...unitsMap.entries()].sort((a, b) => a[1] - b[1]);

    // STEP 2: find min units
    const minUnits = sorted[0][1];

    // STEP 3: select all tied numbers
    let tied = sorted.filter(([num, units]) => units === minUnits);

    // STEP 4: if >5 tied, randomly pick 5
    if (tied.length > 5) {
      tied = tied.sort(() => Math.random() - 0.5).slice(0, 5);
    }

    // Candidates = tied list
    const candidates = tied;

    type Eval = {
      number: number;
      realUnits: number;
      dummyUnits: number;
      unitPrize: number;
      payoutToReal: number;
      scaledPayoutUsed: boolean;
      profit: number;
    };

    const evaluations: Eval[] = [];

    for (const [num, R] of candidates) {
      let dummyUnits = 0;
      let unitPrize = 0;
      let payoutToReal = 0;
      let scaledPayoutUsed = false;

      if (R > 0) {
        if (M <= 0) {
          dummyUnits = 0;
          unitPrize = 0;
          payoutToReal = 0;
          scaledPayoutUsed = true;
        } else {
          const numerator = W * R;
          const neededD = Math.ceil(numerator / M - R);
          dummyUnits = Math.max(0, neededD);

          // fallback when too many dummy units
          if (R + dummyUnits > maxBidLimitPerNumber) {
            dummyUnits = 0;
            unitPrize = Number((M / R).toFixed(2));
            payoutToReal = Number((unitPrize * R).toFixed(2));
            scaledPayoutUsed = true;
          } else {
            unitPrize = Number((W / (R + dummyUnits)).toFixed(2));
            payoutToReal = Number((unitPrize * R).toFixed(2));
          }
        }
      } else {
        // Zero real winners → cosmetic dummy
        const minDisplay = 20;
        const maxDisplay = 50;
        const chosen =
          Math.floor(Math.random() * (maxDisplay - minDisplay + 1)) +
          minDisplay;
        dummyUnits = Math.ceil(W / chosen);

        if (dummyUnits > maxBidLimitPerNumber)
          dummyUnits = maxBidLimitPerNumber;

        unitPrize = Number((W / dummyUnits).toFixed(2));
        payoutToReal = 0;
      }

      evaluations.push({
        number: num,
        realUnits: R,
        dummyUnits,
        unitPrize,
        payoutToReal,
        scaledPayoutUsed,
        profit: Number((C - payoutToReal).toFixed(2)),
      });
    }

    // pick highest profit
    evaluations.sort(
      (a, b) => b.profit - a.profit || a.realUnits - b.realUnits,
    );

    const best = evaluations[0];
    if (!best) return;

    await this.biddingService.announceResult('SYSTEM', {
      slotId,
      winningNumber: best.number,
      note: 'AUTO: picked from least-bid numbers (fair=randomized)',
    } as any);
  }

  // ---------
  // AUTO ANNOUNCE JP
  // ---------
  private async autoAnnounceJP(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      select: { settingsJson: true },
    });

    if (!slot) throw new BadRequestException('Slot not found');

    const settings = (slot.settingsJson as Record<string, any>) || {};

    const W = Number(settings.winningPrize ?? 0);
    const minProfitPct = Number(settings.minProfitPct ?? 0.15);

    // total collected
    const aggCollected = await this.prisma.bid.aggregate({
      where: { slotId },
      _sum: { amount: true },
    });

    const C = aggCollected._sum?.amount ? Number(aggCollected._sum.amount) : 0;
    const M = Number((C - C * minProfitPct).toFixed(2));

    const bids = await this.prisma.bid.findMany({
      where: { slotId },
      select: { jpNumbers: true },
    });

    const comboMap = new Map<string, number>();

    for (const b of bids) {
      if (!b.jpNumbers || b.jpNumbers.length !== 6) continue;
      const key = [...b.jpNumbers].sort((a, b) => a - b).join(',');
      comboMap.set(key, (comboMap.get(key) || 0) + 1);
    }

    const combosArray = [...comboMap.entries()].map(([k, v]) => ({
      combo: k,
      count: v,
    }));

    let candidateCombos: { combo: string; count: number }[] = [];

    if (combosArray.length === 0) {
      // No real combos → generate 5 random ones
      for (let i = 0; i < 5; i++) {
        const set = new Set<number>();
        while (set.size < 6) set.add(Math.floor(Math.random() * 37) + 1);
        const arr = [...set].sort((a, b) => a - b);
        candidateCombos.push({ combo: arr.join(','), count: 0 });
      }
    } else {
      // STEP 1: sort by count ASC
      combosArray.sort((a, b) => a.count - b.count);

      // STEP 2: find min unit count
      const minUnits = combosArray[0].count;

      // STEP 3: take all tied
      let tied = combosArray.filter((c) => c.count === minUnits);

      // STEP 4: if >5, shuffle and pick 5
      if (tied.length > 5) {
        tied = tied.sort(() => Math.random() - 0.5).slice(0, 5);
      }

      candidateCombos = tied;
    }

    type EvalJP = {
      combo: string;
      realUnits: number;
      dummyUnits: number;
      unitPrize: number;
      payoutToReal: number;
      profit: number;
    };

    const evals: EvalJP[] = [];

    for (const c of candidateCombos) {
      const R = c.count;
      let dummyUnits = 0;
      let unitPrize = 0;
      let payoutToReal = 0;

      if (R > 0) {
        if (M <= 0) {
          unitPrize = 0;
          payoutToReal = 0;
        } else {
          const numerator = W * R;
          const neededD = Math.ceil(numerator / M - R);
          dummyUnits = Math.max(0, neededD);

          unitPrize = Number((W / (R + dummyUnits)).toFixed(2));
          payoutToReal = Number((unitPrize * R).toFixed(2));
        }
      } else {
        const minDisplay = 20;
        const maxDisplay = 50;
        const chosen =
          Math.floor(Math.random() * (maxDisplay - minDisplay + 1)) +
          minDisplay;

        dummyUnits = Math.ceil(W / chosen);
        unitPrize = Number((W / dummyUnits).toFixed(2));
        payoutToReal = 0;
      }

      evals.push({
        combo: c.combo,
        realUnits: R,
        dummyUnits,
        unitPrize,
        payoutToReal,
        profit: Number((C - payoutToReal).toFixed(2)),
      });
    }

    // pick best
    evals.sort((a, b) => b.profit - a.profit || a.realUnits - b.realUnits);
    const best = evals[0];
    if (!best) return;

    await this.biddingService.announceResult('SYSTEM', {
      slotId,
      winningCombo: best.combo.split(',').join('-'),
      note: 'AUTO: randomized least-used combos',
    } as any);
  }
}
