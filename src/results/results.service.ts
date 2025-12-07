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
    return raw > 1 ? raw / 100 : raw;
  }

  // Helper: Convert UTC Date → Malaysian local date/time strings
  private formatToMYT(date: Date | string) {
    const d = new Date(date);
    return {
      date: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d), // → "2025-12-07"

      time: new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kuala_Lumpur',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .format(d)
        .replace(' AM', 'AM')
        .replace(' PM', 'PM'), // → "8:00 PM
    };
  }

  /* ============================================================
      1. BASIC RESULT BY SLOT ID
  ============================================================ */
  async getResultBySlotId(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { drawResult: true },
    });

    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.drawResult)
      throw new NotFoundException('Result not yet declared for this slot');

    const now = new Date();
    const slotTimeMYT = new Date(slot.slotTime);
    // Compare using actual time (both are UTC, so safe)
    if (now < slotTimeMYT) {
      const { date, time } = this.formatToMYT(slot.slotTime);
      return {
        slotId: slot.id,
        uniqueSlotId: slot.uniqueSlotId,
        type: slot.type,
        date,
        time,
        slotTime: slot.slotTime,
        isVisible: false,
        availableAt: slot.slotTime,
      };
    }

    const { date, time } = this.formatToMYT(slot.slotTime);

    return {
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      type: slot.type,
      date,
      time,
      slotTime: slot.slotTime,
      winningNumber: slot.drawResult.winner,
      createdAt: slot.drawResult.createdAt,
      isVisible: true,
    };
  }

  /* ============================================================
      2. GET ALL RESULTS (LIGHTWEIGHT) — Public endpoint
      Returns: visible results with MYT date/time + winning number/combo
  ============================================================ */
  async getAllResults(type?: 'LD' | 'JP', limit = 50) {
    const slots = await this.prisma.slot.findMany({
      where: {
        ...(type && { type }),
        drawResult: { isNot: null },
      },
      include: {
        drawResult: true, // ← MUST include this!
      },
      orderBy: {
        slotTime: 'desc', // ← Correct syntax
      },
      take: limit,
    });

    const now = new Date();

    return slots.map((slot) => {
      const draw = slot.drawResult!; // now safe
      const visible = now >= new Date(slot.slotTime);
      const { date, time } = this.formatToMYT(slot.slotTime);

      let winningNumber: number | null = null;
      let winningCombo: number[] | null = null;

      if (visible) {
        if (slot.type === 'LD') {
          winningNumber = draw.winner ? Number(draw.winner) : null;
        } else if (typeof draw.winner === 'string') {
          winningCombo = draw.winner
            .split('-')
            .map((n) => Number(n.trim()))
            .filter(Boolean);
        }
      }

      return {
        slotId: slot.id,
        uniqueSlotId: slot.uniqueSlotId,
        type: slot.type,
        date,
        time,
        isVisible: visible,
        winningNumber,
        winningCombo,
        announcedAt: visible ? draw.createdAt : null,
      };
    });
  }

  /* ============================================================
      3. RESULTS BY DATE → MALAYSIAN DATE (MYT)
      Public endpoint — returns LD & JP results for a given MYT date
  ============================================================ */
  async getResultsByDate(dateString?: string) {
    let startMYT: Date;
    let endMYT: Date;

    if (dateString) {
      const [y, m, d] = dateString.split('-').map(Number);
      startMYT = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); // 00:00 MYT
      endMYT = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)); // 23:59:59.999 MYT
    } else {
      // Today in MYT
      const nowMYT = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }),
      );
      startMYT = new Date(
        Date.UTC(nowMYT.getFullYear(), nowMYT.getMonth(), nowMYT.getDate()),
      );
      endMYT = new Date(
        Date.UTC(
          nowMYT.getFullYear(),
          nowMYT.getMonth(),
          nowMYT.getDate(),
          23,
          59,
          59,
          999,
        ),
      );
    }

    // Convert MYT → UTC for DB query
    const startUTC = new Date(startMYT.getTime() - 8 * 60 * 60 * 1000);
    const endUTC = new Date(endMYT.getTime() - 8 * 60 * 60 * 1000);

    const drawResults = await this.prisma.drawResult.findMany({
      where: {
        createdAt: {
          gte: startUTC,
          lte: endUTC,
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
      orderBy: { slot: { slotTime: 'asc' } },
    });

    const displayDate =
      dateString ||
      new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur',
      });

    const results = drawResults.map((draw) => {
      const { date, time } = this.formatToMYT(draw.slot.slotTime);

      let winningNumber: number | null = null;
      let winningCombo: number[] | null = null;

      if (draw.slot.type === 'LD') {
        winningNumber = draw.winner ? Number(draw.winner) : null;
      } else {
        if (typeof draw.winner === 'string') {
          winningCombo = draw.winner
            .split('-')
            .map((n) => Number(n.trim()))
            .filter(Boolean);
        }
      }

      return {
        slotId: draw.slot.id,
        uniqueSlotId: draw.slot.uniqueSlotId,
        type: draw.slot.type,
        date,
        time,
        winningNumber,
        winningCombo,
        announcedAt: draw.createdAt,
      };
    });

    return {
      date: displayDate,
      LD: results.filter((r) => r.type === 'LD'),
      JP: results.filter((r) => r.type === 'JP'),
    };
  }

  /* ============================================================
      4. HISTORY GROUPED BY DATE (MYT)
  ============================================================ */
  async getHistoryGrouped() {
    const results = await this.prisma.drawResult.findMany({
      include: { slot: true },
      orderBy: { createdAt: 'desc' },
    });

    const grouped: Record<string, { LD: any[]; JP: any[] }> = {};

    results.forEach((entry) => {
      const mytDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuala_Lumpur',
      }).format(new Date(entry.slot.slotTime));

      if (!grouped[mytDate]) {
        grouped[mytDate] = { LD: [], JP: [] };
      }

      const { date, time } = this.formatToMYT(entry.slot.slotTime);

      const data = {
        slotId: entry.slot.id,
        uniqueSlotId: entry.slot.uniqueSlotId,
        type: entry.slot.type,
        date,
        time,
        winningNumber: entry.winner,
        announcedAt: entry.createdAt,
      };

      if (entry.slot.type === 'LD') grouped[mytDate].LD.push(data);
      else grouped[mytDate].JP.push(data);
    });

    // Sort each group by time
    Object.values(grouped).forEach((group) => {
      group.LD.sort((a, b) => a.time.localeCompare(b.time));
      group.JP.sort((a, b) => a.time.localeCompare(b.time));
    });

    return grouped;
  }

  /* ============================================================
      INTERNAL: FORMAT ADMIN REPORT (WITH MYT DATE/TIME)
  ============================================================ */
  private formatAdminReport(slot: any) {
    const draw = slot.drawResult;
    const settings = slot.settingsJson || {};

    const { date, time } = this.formatToMYT(slot.slotTime);

    const W = Number(settings.winningPrize ?? 0);
    const profitPct = this.normalizePct(settings.minProfitPct, 15);

    const totalCollected =
      slot.bids?.reduce(
        (sum: number, b: any) => sum + Number(b.amount || 0),
        0,
      ) ?? 0;
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

    if (slot.type === 'LD' && draw?.winner != null) {
      winningNumber = Number(draw.winner);
    } else if (typeof draw?.winner === 'string') {
      winningCombo = draw.winner
        .split('-')
        .map((n: string) => Number(n.trim()))
        .filter(Boolean);
    }

    return {
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      date,
      time, // e.g. "8:00 PM"
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
      5. ADMIN SINGLE SLOT REPORT
  ============================================================ */
  async getAdminSlotResult(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: { drawResult: true, bids: true },
    });

    if (!slot) throw new BadRequestException('Slot not found');
    if (!slot.drawResult) throw new BadRequestException('Result not announced');

    const report = this.formatAdminReport(slot);
    const cosmeticUnits = (slot.drawResult.meta as any)?.cosmeticUnits || null;

    return { ...report, cosmeticUnits };
  }

  /* ============================================================
      6. ALL ADMIN REPORTS
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
    // console.log(slots.map(slot => this.formatAdminReport(slot)))
    return slots.map((slot) => this.formatAdminReport(slot));
  }

  /* ============================================================
      7. ADMIN RESULTS BY DATE → FULL FINANCIAL REPORT FOR A MALAYSIAN DATE
      Returns full admin report (profit, units, etc.) for a specific MYT date
  ============================================================ */
  async getAdminResultsByDate(dateString: string) {
    if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      throw new BadRequestException(
        'Valid dateString (YYYY-MM-DD) is required',
      );
    }

    const [y, m, d] = dateString.split('-').map(Number);

    // Midnight to end of day in Malaysian Time (MYT = UTC+8)
    const startMYT = new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); // 00:00 MYT
    const endMYT = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)); // 23:59:59.999 MYT

    // Convert to UTC for database query
    const startUTC = new Date(startMYT.getTime() - 8 * 60 * 60 * 1000);
    const endUTC = new Date(endMYT.getTime() - 8 * 60 * 60 * 1000);

    const slots = await this.prisma.slot.findMany({
      where: {
        drawResult: { isNot: null },
        slotTime: {
          gte: startUTC,
          lte: endUTC,
        },
      },
      include: {
        drawResult: true,
        bids: true,
      },
      orderBy: { slotTime: 'asc' },
    });

    if (slots.length === 0) {
      return {
        date: dateString,
        results: [],
        summary: {
          totalCollected: 0,
          totalProfit: 0,
          totalPaid: 0,
          avgProfitPct: 0,
        },
      };
    }

    const results = slots.map((slot) => this.formatAdminReport(slot));

    const summary = {
      totalCollected: results.reduce((sum, r) => sum + r.totalCollected, 0),
      totalProfit: results.reduce((sum, r) => sum + r.netProfit, 0),
      totalPaid: results.reduce((sum, r) => sum + r.payoutToReal, 0),
      avgProfitPct:
        results.length > 0
          ? results.reduce((sum, r) => sum + r.profitPct, 0) / results.length
          : 0,
    };

    // console.log({
    //   date: dateString,
    //   results,
    //   summary,
    // });

    return {
      date: dateString,
      results,
      summary,
    };
  }

  /* ============================================================
      8. ADMIN RESULTS BY RANGE → Full financial report for last X days or all time
      Used by: Last 7/14/30/90 days & All Time in admin report
  ============================================================ */
  async getAdminResultsByRange(days?: number) {
    let startUTC: Date | null = null;

    if (days && days > 0) {
      // Calculate Malaysian midnight X days ago
      const nowMYT = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }),
      );
      const targetMYT = new Date(nowMYT);
      targetMYT.setDate(targetMYT.getDate() - days);

      // Set to midnight MYT
      const midnightMYT = new Date(
        Date.UTC(
          targetMYT.getFullYear(),
          targetMYT.getMonth(),
          targetMYT.getDate(),
          0,
          0,
          0,
        ),
      );

      // Convert to UTC
      startUTC = new Date(midnightMYT.getTime() - 8 * 60 * 60 * 1000);
    }
    // If days === 0 or null → no filter = all time

    const slots = await this.prisma.slot.findMany({
      where: {
        drawResult: { isNot: null },
        ...(startUTC && {
          slotTime: {
            gte: startUTC,
          },
        }),
      },
      include: {
        drawResult: true,
        bids: true,
      },
      orderBy: { slotTime: 'desc' },
    });

    if (slots.length === 0) {
      return {
        range: days ? `Last ${days} days` : 'All Time',
        fromDate: days ? new Date(startUTC!).toISOString().split('T')[0] : null,
        results: [],
        summary: {
          totalCollected: 0,
          totalProfit: 0,
          totalPaid: 0,
          avgProfitPct: 0,
          totalSlots: 0,
        },
      };
    }

    const results = slots.map((slot) => this.formatAdminReport(slot));

    const summary = {
      totalCollected: Number(
        results.reduce((sum, r) => sum + r.totalCollected, 0).toFixed(2),
      ),
      totalProfit: Number(
        results.reduce((sum, r) => sum + r.netProfit, 0).toFixed(2),
      ),
      totalPaid: Number(
        results.reduce((sum, r) => sum + r.payoutToReal, 0).toFixed(2),
      ),
      avgProfitPct: Number(
        (
          results.reduce((sum, r) => sum + r.profitPct, 0) / results.length
        ).toFixed(4),
      ),
      totalSlots: results.length,
    };

    return {
      range: days ? `Last ${days} days` : 'All Time',
      fromDate: days ? new Date(startUTC!).toISOString().split('T')[0] : null,
      toDate: new Date().toISOString().split('T')[0],
      results,
      summary,
    };
  }
}
