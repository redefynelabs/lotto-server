import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ResultsService {
  constructor(private prisma: PrismaService) {}

  private normalizePct(value: any, fallback: number = 15) {
    const raw = Number(value ?? fallback);
    const pct = raw > 1 ? raw / 100 : raw;
    console.log('DEBUG profitPct:', { raw, normalized: pct });
    return pct;
  }

  /* ============================================================
      1. BASIC RESULT BY SLOT ID
     - result locked until slotTime (visibility)
  ============================================================ */
  async getResultBySlotId(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { drawResult: true },
    });

    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.drawResult)
      throw new NotFoundException('Result not yet declared for this slot');

    // RESULT IS LOCKED UNTIL SLOT TIME (compare using Date objects)
    const now = new Date();
    if (now < new Date(slot.slotTime)) {
      return {
        slotId: slot.id,
        uniqueSlotId: slot.uniqueSlotId,
        type: slot.type,
        slotTime: slot.slotTime,
        isVisible: false,
        availableAt: slot.slotTime,
      };
    }

    return {
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      type: slot.type,
      slotTime: slot.slotTime,
      winningNumber: slot.drawResult.winner,
      createdAt: slot.drawResult.createdAt,
      isVisible: true,
    };
  }

  /* ============================================================
      2. BASIC ALL RESULTS (LIGHTWEIGHT)
  ============================================================ */
  async getAllResults(type?: 'LD' | 'JP', limit = 50) {
    const slots = await this.prisma.slot.findMany({
      where: {
        ...(type && { type }),
        drawResult: { isNot: null },
      },
      include: { drawResult: true },
      orderBy: { slotTime: 'desc' },
      take: limit,
    });

    const now = new Date();

    return slots.map((slot) => {
      const visible = now >= new Date(slot.slotTime);

      return {
        slotId: slot.id,
        uniqueSlotId: slot.uniqueSlotId,
        type: slot.type,
        slotTime: slot.slotTime,
        isVisible: visible,
        winningNumber: visible ? slot.drawResult?.winner : null,
        createdAt: visible ? slot.drawResult?.createdAt : null,
        availableAt: slot.slotTime,
      };
    });
  }

  /* ============================================================
      3. RESULTS BY DATE (LOCAL-DATE semantics)
      Accepts dateString "YYYY-MM-DD" and returns draws announced
      on that *local* date (not UTC-shifted).
  ============================================================ */
  async getResultsByDate(dateString?: string) {
    // Interpret dateString as local date (midnight local)
    const targetDate = dateString
      ? new Date(`${dateString}T00:00:00`) // no trailing Z -> local midnight
      : new Date();

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const drawResults = await this.prisma.drawResult.findMany({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        slot: {
          select: {
            id: true,
            uniqueSlotId: true,
            type: true,
            slotTime: true,
          },
        },
      },
      orderBy: {
        slot: { slotTime: 'asc' },
      },
    });

    const results = drawResults.map((draw) => ({
      slotId: draw.slot.id,
      uniqueSlotId: draw.slot.uniqueSlotId,
      type: draw.slot.type,
      slotTime: draw.slot.slotTime,
      winningNumber: draw.winner,
      announcedAt: draw.createdAt,
    }));

    return {
      date: targetDate.toISOString().split('T')[0],
      LD: results.filter((r) => r.type === 'LD'),
      JP: results.filter((r) => r.type === 'JP'),
    };
  }

  /* ============================================================
      4. HISTORY GROUPED BY DATE
  ============================================================ */
  async getHistoryGrouped() {
    const results = await this.prisma.drawResult.findMany({
      include: { slot: true },
      orderBy: { createdAt: 'desc' },
    });

    const grouped: Record<string, { LD: any[]; JP: any[] }> = {};

    results.forEach((entry) => {
      const dateKey = entry.createdAt.toISOString().split('T')[0];

      if (!grouped[dateKey]) {
        grouped[dateKey] = { LD: [], JP: [] };
      }

      const data = {
        slotId: entry.slot.id,
        uniqueSlotId: entry.slot.uniqueSlotId,
        type: entry.slot.type,
        slotTime: entry.slot.slotTime,
        winningNumber: entry.winner,
        announcedAt: entry.createdAt,
      };

      if (entry.slot.type === 'LD') grouped[dateKey].LD.push(data);
      else grouped[dateKey].JP.push(data);
    });

    for (const date in grouped) {
      grouped[date].LD.sort(
        (a, b) =>
          new Date(a.slotTime).getTime() - new Date(b.slotTime).getTime(),
      );
      grouped[date].JP.sort(
        (a, b) =>
          new Date(a.slotTime).getTime() - new Date(b.slotTime).getTime(),
      );
    }

    return grouped;
  }

  /* ============================================================
      INTERNAL: FORMAT ADMIN FULL REPORT OBJECT
      - defensive numeric parsing
      - safe winner parsing
  ============================================================ */
  private formatAdminReport(slot: any) {
    const draw = slot.drawResult;
    const settings = slot.settingsJson || {};

    // fallback values
    const W = Number(settings.winningPrize ?? 0);
    const profitPct = this.normalizePct(settings.minProfitPct, 15);

    const totalCollected =
      slot.bids?.reduce((sum, b) => sum + Number(b.amount || 0), 0) ?? 0;

    const profitAmount = Number((totalCollected * profitPct).toFixed(2));
    const remainingForPayout = Number(
      (totalCollected - profitAmount).toFixed(2),
    );

    const totalUnits = Number(draw?.totalUnits ?? 0);
    const dummyUnits = Number(draw?.dummyUnits ?? 0);
    const realUnits = Math.max(0, totalUnits - dummyUnits);

    const unitPayout = Number(draw?.perUnitPayout ?? 0);
    const payoutToReal = Number(draw?.payoutTotal ?? 0);

    const winningAmountDisplay = Number((unitPayout * totalUnits).toFixed(2));
    const netProfit = Number((totalCollected - payoutToReal).toFixed(2));

    let winningNumber: number | null = null;
    let winningCombo: number[] | null = null;

    if (slot.type === 'LD') {
      if (draw && draw.winner != null) {
        winningNumber = Number(draw.winner);
      }
    } else if (draw && typeof draw.winner === 'string') {
      try {
        winningCombo = draw.winner
          .split('-')
          .map((n: string) => Number(n.trim()));
      } catch (e) {
        winningCombo = null;
      }
    }

    return {
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      date: slot.slotTime.toISOString().slice(0, 10),
      time: slot.slotTime.toISOString().slice(11, 16),

      type: slot.type,

      winningNumber,
      winningCombo,

      winningAmountDisplay,
      winningAmountConfigured: W,

      totalCollected,
      profitPct,
      profitAmount,

      remainingForPayout,
      realUnits,
      dummyUnits,
      totalUnits,

      unitPayout,
      payoutToReal,

      netProfit,
    };
  }

  /* ============================================================
      5. ADMIN FULL REPORT FOR SINGLE SLOT
  ============================================================ */
  async getAdminSlotResult(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { drawResult: true, bids: true },
    });
    if (!slot) throw new BadRequestException('Slot not found');
    if (!slot.drawResult) throw new BadRequestException('Result not announced');

    const draw = slot.drawResult;
    const settings = (slot.settingsJson as Record<string, any>) || {};
    const W = Number(settings.winningPrize ?? 0);
    const profitPct = this.normalizePct(settings.minProfitPct, 15);


    const totalCollected =
      slot.bids?.reduce((sum, b) => sum + Number(b.amount || 0), 0) ?? 0;
    const profitAmount = Number((totalCollected * profitPct).toFixed(2));
    const remainingForPayout = Number(
      (totalCollected - profitAmount).toFixed(2),
    );

    const totalUnits = Number(draw?.totalUnits ?? 0);
    const dummyUnits = Number(draw?.dummyUnits ?? 0);
    const realUnits = Math.max(0, totalUnits - dummyUnits);
    const unitPayout = Number(draw?.perUnitPayout ?? 0);
    const payoutToReal = Number(draw?.payoutTotal ?? 0);
    const displayedWinningAmount = Number((unitPayout * totalUnits).toFixed(2));
    const netProfit = Number((totalCollected - payoutToReal).toFixed(2));

    const cosmeticUnits =
      (draw.meta && (draw.meta as any).cosmeticUnits) || null;

    let winningNumber: number | null = null;
    let winningCombo: number[] | null = null;
    if (slot.type === 'LD' && draw && draw.winner != null)
      winningNumber = Number(draw.winner);
    else if (draw && typeof draw.winner === 'string')
      winningCombo = draw.winner.split('-').map((n) => Number(n.trim()));

    return {
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      date: slot.slotTime.toISOString().slice(0, 10),
      time: slot.slotTime.toISOString().slice(11, 16),
      type: slot.type,
      winningNumber,
      winningCombo,
      winningAmountDisplay: displayedWinningAmount,
      winningAmountConfigured: W,
      totalCollected,
      profitPct,
      profitAmount,
      remainingForPayout,
      realUnits,
      dummyUnits,
      totalUnits,
      unitPayout,
      payoutToReal,
      netProfit,
      cosmeticUnits,
    };
  }

  /* ============================================================
      6. ALL ADMIN REPORTS (FULL)
  ============================================================ */
  async getAllAdminReports() {
    const slots = await this.prisma.slot.findMany({
      where: { drawResult: { isNot: null } },
      include: {
        drawResult: true,
        bids: true,
      },
      orderBy: { slotTime: 'desc' },
    });

    return slots.map((slot) => this.formatAdminReport(slot));
  }
}
