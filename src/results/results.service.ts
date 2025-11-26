// results.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ResultsService {
  constructor(private prisma: PrismaService) {}

  /* ============================================================
      1. GET RESULT BY SLOT ID
  ============================================================ */
  async getResultBySlotId(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
      include: {
        drawResult: true,
      },
    });

    if (!slot) throw new NotFoundException('Slot not found');
    if (!slot.drawResult)
      throw new NotFoundException('Result not yet declared for this slot');

    return {
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      type: slot.type,
      slotTime: slot.slotTime,
      winningNumber: slot.drawResult.winner,
      createdAt: slot.drawResult.createdAt,
    };
  }

  /* ============================================================
      2. GET ALL RESULTS (OPTIONAL TYPE & LIMIT)
  ============================================================ */
  async getAllResults(type?: 'LD' | 'JP', limit: number = 50) {
    const slots = await this.prisma.slot.findMany({
      where: {
        ...(type && { type }),
        drawResult: {
          isNot: null, // only slots with results
        },
      },
      include: { drawResult: true },
      orderBy: { slotTime: 'desc' },
      take: limit,
    });

    return slots.map((slot) => ({
      slotId: slot.id,
      uniqueSlotId: slot.uniqueSlotId,
      type: slot.type,
      slotTime: slot.slotTime,
      winningNumber: slot.drawResult?.winner,
      createdAt: slot.drawResult?.createdAt,
    }));
  }

  /* ============================================================
      3. GET RESULTS BY DATE (YYYY-MM-DD)
  ============================================================ */
  async getResultsByDate(dateString?: string) {
    const targetDate = dateString
      ? new Date(dateString + 'T00:00:00.000Z')
      : new Date();

    const startOfDay = new Date(targetDate);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

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
      4. HISTORY GROUPED BY DATE (NEW)
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

      const resultData = {
        slotId: entry.slot.id,
        uniqueSlotId: entry.slot.uniqueSlotId,
        type: entry.slot.type,
        slotTime: entry.slot.slotTime,
        winningNumber: entry.winner,
        announcedAt: entry.createdAt,
      };

      if (entry.slot.type === 'LD') grouped[dateKey].LD.push(resultData);
      if (entry.slot.type === 'JP') grouped[dateKey].JP.push(resultData);
    });

    // sort by slotTime inside each day
    for (const date in grouped) {
      grouped[date].LD.sort(
        (a, b) => new Date(a.slotTime).getTime() - new Date(b.slotTime).getTime()
      );
      grouped[date].JP.sort(
        (a, b) => new Date(a.slotTime).getTime() - new Date(b.slotTime).getTime()
      );
    }

    return grouped;
  }
}
