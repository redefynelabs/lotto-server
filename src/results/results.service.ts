  import { Injectable, NotFoundException } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service';

  @Injectable()
  export class ResultsService {
    constructor(private prisma: PrismaService) {}

    //Getting Results using SLOTID
    async getResultBySlotId(slotId: string) {
      const slot = await this.prisma.slot.findUnique({
        where: { id: slotId },
        include: {
          drawResult: true,
        },
      });

      if (!slot) {
        throw new NotFoundException('Slot not found');
      }

      if (!slot.drawResult) {
        throw new NotFoundException('Result not yet declared for this slot');
      }

      return {
        slotId: slot.id,
        uniqueSlotId: slot.uniqueSlotId,
        type: slot.type,
        slotTime: slot.slotTime,
        winningNumber: slot.drawResult.winner,
        createdAt: slot.drawResult.createdAt,
      };
    }
    // Getting Results using TYPE
    async getAllResults(type?: 'LD' | 'JP', limit: number = 50) {
      const slots = await this.prisma.slot.findMany({
        where: {
          ...(type && { type }),
          drawResult: {
            isNot: null,
          },
        },
        include: {
          drawResult: true,
        },
        orderBy: {
          slotTime: 'desc',
        },
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
    // Getting Resutls by Date
   // results.service.ts
async getResultsByDate(dateString?: string) {
  const targetDate = dateString 
    ? new Date(dateString + 'T00:00:00.000Z') 
    : new Date();

  // Start of day (UTC)
  const startOfDay = new Date(targetDate);
  startOfDay.setUTCHours(0, 0, 0, 0);

  // End of day (UTC)
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
      slot: {
        slotTime: 'asc',
      },
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

  const ldResults = results.filter(r => r.type === 'LD');
  const jpResults = results.filter(r => r.type === 'JP');

  return {
    date: targetDate.toISOString().split('T')[0],
    LD: ldResults,
    JP: jpResults,
  };
}
  }
