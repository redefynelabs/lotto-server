import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateBidDto } from './dto/create-bid.dto';
import { AnnounceResultDto } from './dto/announce-result.dto';
import { ResultStreamService } from 'src/results/results-stream.service';

/**
 * BiddingService
 *
 * Responsibilities:
 * - validate and create bids (LD & JP)
 * - enforce slot/window/time rules
 * - check per-number max units (80)
 * - calculate amount using AppSettings (bidPrizeLD, bidPrizeJP)
 * - call walletService.debitForBid + walletService.creditCommission
 * - announce result (admin): compute winners, apply loss-prevention, call walletService.creditWinning to reserve winning
 */

@Injectable()
export class BiddingService {
  private readonly logger = new Logger(BiddingService.name);

  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private readonly resultsStream: ResultStreamService,

  ) {}

  // helper: generate unique bid id
  private generateUniqueBidId(
    slotUniqueId: string,
    customerPhone: string,
    payload: {
      type: 'LD' | 'JP';
      number?: number;
      count?: number;
      jpNumbers?: number[];
    },
  ) {
    if (payload.type === 'LD') {
      // ensure required fields are present
      return `${slotUniqueId}#${customerPhone}#${payload.number}#${payload.count}`;
    } else {
      // join jp numbers using dash
      return `${slotUniqueId}#${customerPhone}#${(payload.jpNumbers || []).join('-')}`;
    }
  }

  // helper: parse winning combo string -> array
  private parseComboString(combo: string) {
    if (!combo) return [];
    return combo
      .split(/[,\-]/)
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
  }

  private normalizePct(value: any, fallback: number = 15) {
    const raw = Number(value ?? fallback);
    const pct = raw > 1 ? raw / 100 : raw;
    // console.log('DEBUG profitPct:', { raw, normalized: pct });
    return pct;
  }

  // Utility: build cosmetic distribution for LD (1..37) or JP combos (optional)
  private buildCosmeticUnitsForLd(
    realUnitsMap: Map<number, number>,
    winningNumber: number,
    realDummyForWinner: number,
  ) {
    const cosmetic: Record<number, number> = {};

    // base per-number cosmetic: small + proportion of real
    for (let n = 1; n <= 37; n++) {
      const real = realUnitsMap.get(n) ?? 0;
      const base = Math.floor(Math.random() * 3) + Math.round(real / 3); // 0..2 + real/3
      cosmetic[n] = Math.max(0, base);
    }

    // set winning cosmetics: real + realDummy + small boost (0..3)
    const boost = Math.floor(Math.random() * 4); // 0..3
    cosmetic[winningNumber] =
      (realUnitsMap.get(winningNumber) ?? 0) + realDummyForWinner + boost;

    // randomly pick 2..4 other spikes (could exceed winner)
    const spikeCount = Math.floor(Math.random() * 3) + 2; // 2..4
    const candidates = Array.from({ length: 37 }, (_, i) => i + 1).filter(
      (n) => n !== winningNumber,
    );
    for (let i = 0; i < spikeCount; i++) {
      const idx = Math.floor(Math.random() * candidates.length);
      const sp = candidates.splice(idx, 1)[0];
      const spikeBoost = Math.floor(Math.random() * 4) + 1; // 1..4
      cosmetic[sp] = Math.max(
        cosmetic[sp],
        cosmetic[winningNumber] + spikeBoost,
      );
    }

    return cosmetic;
  }

  // create bid
  async createBid(agentId: string, dto: CreateBidDto) {
    // fetch slot
    const slot = await this.prisma.slot.findUnique({
      where: { id: dto.slotId },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    if (slot.status !== 'OPEN')
      throw new BadRequestException('Slot is not open for bidding');
    if (new Date() > new Date(slot.windowCloseAt))
      throw new BadRequestException('Bidding window closed for this slot');

    // load settings
    const settings = await this.prisma.appSettings.findFirst();
    if (!settings) throw new BadRequestException('App settings not configured');

    // decide LD or JP based on slot.type
    if (slot.type === 'LD') {
      // validate number & count
      if (dto.number == null || dto.count == null)
        throw new BadRequestException('LD bid requires number and count');
      if (!Number.isInteger(dto.number) || dto.number < 1 || dto.number > 37)
        throw new BadRequestException('LD number must be between 1 and 37');
      if (!Number.isInteger(dto.count) || dto.count <= 0)
        throw new BadRequestException('count must be positive');

      // enforce Max bid count max per number across slot
      // compute current units for this slot + number

      // const agg = await this.prisma.bid.aggregate({
      //   _sum: { count: true },
      //   where: { slotId: dto.slotId, number: dto.number },
      // });
      // const currentUnits = agg._sum?.count ? Number(agg._sum.count) : 0;
      // const maxUnitsPerNumber = Number(settings.ldBidLimitPerNumber);
      // if (currentUnits + dto.count > maxUnitsPerNumber) {
      //   throw new BadRequestException(
      //     `Max ${maxUnitsPerNumber} units allowed per number in this slot. Remaining: ${Math.max(0, maxUnitsPerNumber - currentUnits)}`,
      //   );
      // }

      // calculate amount
      const amount = Number(settings.bidPrizeLD) * Number(dto.count);

      // debit wallet (may go negative)
      await this.walletService.debitForBid(agentId, amount, {
        slotId: dto.slotId,
        number: dto.number,
        type: 'LD',
      });

      // compute commission: prefer agent-specific commissionPct if set else default from settings
      const user = await this.prisma.user.findUnique({
        where: { id: agentId },
      });
      const commissionPct = user?.commissionPct
        ? Number(user.commissionPct)
        : Number(settings.defaultCommissionPct || 0);
      const commission = Math.round(amount * commissionPct * 100) / 100 / 100; // careful — we'll compute as amount * pct/100 accurately below

      // better accurate commission:
      const commissionAmount = Number(
        ((amount * commissionPct) / 100).toFixed(2),
      );

      // credit commission (system)
      await this.walletService.creditCommission(agentId, commissionAmount, {
        slotId: dto.slotId,
        number: dto.number,
      });

      // unique slot code: use slot.uniqueSlotId or uniqueSlotId field
      const slotCode = (slot as any).uniqueSlotId || slot.id;

      const uniqueBidId = this.generateUniqueBidId(
        slotCode,
        dto.customerPhone,
        { type: 'LD', number: dto.number, count: dto.count },
      );

      // create DB bid
      const bid = await this.prisma.bid.create({
        data: {
          userId: agentId,
          slotId: dto.slotId,
          uniqueBidId,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          number: dto.number,
          count: dto.count,
          jpNumbers: [], // empty because LD
          amount: amount,
        },
      });

      return { message: 'Bid placed', bid };
    }

    // ----------------------------
    // Jackpot (JP)
    // ----------------------------
    if (slot.type === 'JP') {
      if (!dto.jpNumbers || !Array.isArray(dto.jpNumbers))
        throw new BadRequestException(
          'JP bid requires jpNumbers array of 6 numbers',
        );
      if (dto.jpNumbers.length !== 6)
        throw new BadRequestException('JP bid requires exactly 6 numbers');
      // validate each number
      for (const n of dto.jpNumbers) {
        if (!Number.isInteger(n) || n < 1 || n > 37)
          throw new BadRequestException(
            'Each JP number must be integer between 1 and 37',
          );
      }

      const amount = Number(settings.bidPrizeJP); // per combo

      // debit wallet
      await this.walletService.debitForBid(agentId, amount, {
        slotId: dto.slotId,
        jpNumbers: dto.jpNumbers,
        type: 'JP',
      });

      // commission calc
      const user = await this.prisma.user.findUnique({
        where: { id: agentId },
      });
      const commissionPct = user?.commissionPct
        ? Number(user.commissionPct)
        : Number(settings.defaultCommissionPct || 0);
      const commissionAmount = Number(
        ((amount * commissionPct) / 100).toFixed(2),
      );

      await this.walletService.creditCommission(agentId, commissionAmount, {
        slotId: dto.slotId,
        jpNumbers: dto.jpNumbers,
      });

      const slotCode = (slot as any).uniqueSlotId || slot.id;
      const uniqueBidId = this.generateUniqueBidId(
        slotCode,
        dto.customerPhone,
        { type: 'JP', jpNumbers: dto.jpNumbers },
      );

      const bid = await this.prisma.bid.create({
        data: {
          userId: agentId,
          slotId: dto.slotId,
          uniqueBidId,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          number: 0, // for JP store dummy 0
          count: 1, // single combo (we treat count=1 for JP)
          jpNumbers: dto.jpNumbers,
          amount: amount,
        },
      });

      return { message: 'JP Bid placed', bid };
    }

    throw new BadRequestException('Unsupported slot type');
  }

  //get remaining bid count for the number slot wise
  // async getRemainingCount(slotId: string, number: number) {
  //   const settings = await this.prisma.appSettings.findFirst();
  //   if (!settings) throw new BadRequestException('Settings missing');

  //   const maxCount = Number(settings.ldBidLimitPerNumber); // or make separate config like maxLdCount

  //   // total bids so far
  //   const total = await this.prisma.bid.aggregate({
  //     where: { slotId, number },
  //     _sum: { count: true },
  //   });

  //   const used = Number(total._sum.count || 0);
  //   const remaining = Math.max(maxCount - used, 0);

  //   return {
  //     number,
  //     used,
  //     maxCount,
  //     remaining,
  //   };
  // }

  // get bids by slot (admin)
  async getBidsBySlot(slotId: string) {
    const bids = await this.prisma.bid.findMany({
      where: { slotId },
      orderBy: { createdAt: 'asc' },
    });
    return bids;
  }

  // get agent's bids
  async getMyBids(agentId: string, page = 1, pageSize = 50) {
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.bid.findMany({
        where: { userId: agentId },
        include: {
          slot: {
            select: {
              id: true,
              type: true,
              slotTime: true,
              status: true, 
              drawResult: {
                select: {
                  winner: true,
                  createdAt: true,
                },
              },
            },
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.bid.count({ where: { userId: agentId } }),
    ]);

    return { items, total, page, pageSize };
  }

  async getBidSummary(slotId: string) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: slotId },
    });

    if (!slot) throw new NotFoundException('Slot not found');

    // LD — Lucky Draw Summary
    if (slot.type === 'LD') {
      const numbers = await this.prisma.bid.groupBy({
        by: ['number'],
        where: { slotId },
        _sum: { count: true },
      });

      return {
        type: 'LD',
        summary: numbers.map((n) => ({
          number: n.number,
          count: Number(n._sum.count || 0),
        })),
        totalUnits: numbers.reduce((a, b) => a + Number(b._sum.count || 0), 0),
      };
    }

    // JP — Jackpot Summary
    if (slot.type === 'JP') {
      const combos = await this.prisma.bid.findMany({
        where: { slotId },
        select: { jpNumbers: true },
      });

      const map = new Map<string, number>();

      combos.forEach((bid) => {
        const key = bid.jpNumbers.sort((a, b) => a - b).join('-');
        map.set(key, (map.get(key) || 0) + 1);
      });

      return {
        type: 'JP',
        summary: Array.from(map.entries()).map(([key, count], i) => ({
          id: i + 1,
          numbers: key.split('-').map((n) => Number(n)),
          count,
        })),
        totalUnits: combos.length,
      };
    }

    throw new BadRequestException('Invalid slot type');
  }

  // announce result for a slot (admin)
  // This will compute winners, apply loss-prevention for LD, and call walletService.creditWinning(userId, payout, meta)
  async announceResult(adminId: string, dto: AnnounceResultDto) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: dto.slotId },
    });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.status === 'COMPLETED')
      throw new BadRequestException('Result already announced');
    if (slot.status === 'OPEN' && new Date() < new Date(slot.windowCloseAt)) {
      throw new BadRequestException(
        'Cannot announce result before bidding window closes',
      );
    }

    const settings = await this.prisma.appSettings.findFirst();
    if (!settings) throw new BadRequestException('App settings not configured');

    const minProfitPct = this.normalizePct(settings.minProfitPct, 15);

    // collected
    const aggCollected = await this.prisma.bid.aggregate({
      where: { slotId: slot.id },
      _sum: { amount: true },
    });
    const collected = Number(aggCollected._sum.amount ?? 0);

    const minProfit = Number((collected * minProfitPct).toFixed(2));
    const maxAllowedPayout = Number((collected - minProfit).toFixed(2));

    // helper to persist draw + mark slot completed (called only after successful credits)
    const persistDraw = async (params: {
      winner: string;
      dummyUnits: number;
      totalUnits: number;
      unitPrize: number;
      payoutTotal: number;
      meta?: any;
    }) => {
      const draw = await this.prisma.drawResult.create({
        data: {
          slotId: slot.id,
          winner: params.winner,
          dummyUnits: params.dummyUnits,
          totalUnits: params.totalUnits,
          perUnitPayout: params.unitPrize,
          payoutTotal: params.payoutTotal,
          meta: {
            adminId,
            collected,
            minProfitPct,
            maxAllowedPayout,
            ...(params.meta ?? {}),
          },
        },
      });

      await this.prisma.slot.update({
        where: { id: slot.id },
        data: { status: 'COMPLETED' },
      });
      return draw;
    };

    const M = maxAllowedPayout;

    // ----------------- LD -----------------
    if (slot.type === 'LD') {
      const W = Number(settings.winningPrizeLD ?? 0);
      if (dto.winningNumber == null)
        throw new BadRequestException('winningNumber required for LD');
      const winningNumber = dto.winningNumber;

      // real units for winning number
      const aggUnits = await this.prisma.bid.aggregate({
        where: { slotId: slot.id, number: winningNumber },
        _sum: { count: true },
      });
      const R = Number(aggUnits._sum.count ?? 0);

      // build per-number real map for cosmetic distribution
      const perNumber = await this.prisma.bid.groupBy({
        by: ['number'],
        where: { slotId: slot.id },
        _sum: { count: true },
      });
      const realUnitsMap = new Map<number, number>();
      for (const r of perNumber)
        realUnitsMap.set(Number(r.number), Number(r._sum?.count ?? 0));
      for (let n = 1; n <= 37; n++)
        if (!realUnitsMap.has(n)) realUnitsMap.set(n, 0);

      let dummyUnits = 0;
      let unitPrize = 0;
      let payoutToReal = 0;
      let scaled = false;

      if (R > 0) {
        if (M <= 0) {
          dummyUnits = 0;
          unitPrize = 0;
          payoutToReal = 0;
          scaled = true;
        } else {
          // compute minimum dummy needed to cap payout to M
          const D = Math.ceil((W * R) / M - R);
          dummyUnits = Math.max(0, D);

          const unitPrizeRaw = W / (R + dummyUnits); // raw (unrounded)
          unitPrize = Number(unitPrizeRaw.toFixed(2)); // display/transaction rounding
          const payoutRaw = unitPrizeRaw * R;
          payoutToReal = Number(payoutRaw.toFixed(2));
        }
      } else {
        // no real winners → cosmetic dummy only for display, and real payout = 0
        const p = Math.floor(Math.random() * (50 - 20 + 1)) + 20;
        dummyUnits = Math.ceil(W / p);
        unitPrize = Number((W / dummyUnits).toFixed(2));
        payoutToReal = 0;
      }

      // Build cosmetic distribution (display only)
      const cosmeticUnits = this.buildCosmeticUnitsForLd(
        realUnitsMap,
        winningNumber,
        dummyUnits,
      );

      // If there are real winners and payoutToReal > 0, attempt to credit them FIRST
      if (R > 0 && payoutToReal > 0) {
        const winningBids = await this.prisma.bid.findMany({
          where: { slotId: slot.id, number: winningNumber },
        });
        const failedCredits: Array<{
          userId: string;
          bidId: string;
          reason: string;
        }> = [];

        // Use unitPrizeRaw for fair per-winner calculation when available
        const unitPrizeRaw = R + dummyUnits > 0 ? W / (R + dummyUnits) : 0;

        for (const b of winningBids) {
          const count = Number(b.count ?? 0);
          // compute per-winner payout from raw unit price then round
          const payoutRaw = unitPrizeRaw * count;
          const payout = Number(payoutRaw.toFixed(2));

          if (payout <= 0) {
            failedCredits.push({
              userId: b.userId,
              bidId: b.id,
              reason: 'payout rounded to 0',
            });
            continue;
          }

          try {
            // creditWinning may throw if wallet not found or amount invalid
            await this.walletService.creditWinning(b.userId, payout, {
              slotId: slot.id,
              bidId: b.id,
            });
          } catch (err: any) {
            console.error('creditWinning failed for LD', {
              userId: b.userId,
              bidId: b.id,
              err,
            });
            failedCredits.push({
              userId: b.userId,
              bidId: b.id,
              reason: String(err?.message ?? err),
            });
          }
        }

        if (failedCredits.length > 0) {
          // Do not persist draw or mark slot completed if credits failed.
          // Return clear failure so admin can investigate.
          throw new BadRequestException({
            message: 'Some winner credits failed',
            details: failedCredits,
          });
        }
      }

      // All credits (if any) succeeded. Persist draw and mark slot completed.
      const draw = await persistDraw({
        winner: String(winningNumber),
        dummyUnits,
        totalUnits: R + dummyUnits,
        unitPrize,
        payoutTotal: payoutToReal,
        meta: {
          scaled,
          mode: 'LD',
          cosmeticUnits,
          credited: R > 0 && payoutToReal > 0 ? true : false,
        },
      });

      this.resultsStream.emit(draw);


      return { message: 'LD result announced', draw };
    }

    // ----------------- JP -----------------
    if (slot.type === 'JP') {
      if (!dto.winningCombo)
        throw new BadRequestException('winningCombo required for JP');
      const winningCombo = this.parseComboString(dto.winningCombo);
      if (winningCombo.length !== 6)
        throw new BadRequestException('Winning combo must have 6 numbers');

      const allBids = await this.prisma.bid.findMany({
        where: { slotId: slot.id },
        select: { jpNumbers: true, userId: true, id: true },
      });
      const winners = allBids.filter((b) => {
        if (!b.jpNumbers || b.jpNumbers.length !== 6) return false;
        const a = [...b.jpNumbers].sort((x, y) => x - y);
        const w = [...winningCombo].sort((x, y) => x - y);
        return a.join(',') === w.join(',');
      });

      const R = winners.length;
      const W = Number(settings.winningPrizeJP ?? 0);

      let dummyUnits = 0;
      let unitPrize = 0;
      let payoutToReal = 0;
      let scaled = false;

      if (R > 0) {
        if (M <= 0) {
          dummyUnits = 0;
          unitPrize = 0;
          payoutToReal = 0;
          scaled = true;
        } else {
          const D = Math.ceil((W * R) / M - R);
          dummyUnits = Math.max(0, D);

          const unitPrizeRaw = W / (R + dummyUnits);
          unitPrize = Number(unitPrizeRaw.toFixed(2));
          const payoutRaw = unitPrizeRaw * R;
          payoutToReal = Number(payoutRaw.toFixed(2));
        }
      } else {
        const p = Math.floor(Math.random() * (50 - 20 + 1)) + 20;
        dummyUnits = Math.ceil(W / p);
        unitPrize = Number((W / dummyUnits).toFixed(2));
        payoutToReal = 0;
      }

      // Build cosmetic units for JP - simplified: random distribution across numbers 1..37
      const realCounts = new Map<number, number>();
      for (const b of allBids) {
        if (!b.jpNumbers) continue;
        for (const n of b.jpNumbers)
          realCounts.set(n, (realCounts.get(n) ?? 0) + 1);
      }
      for (let n = 1; n <= 37; n++)
        if (!realCounts.has(n)) realCounts.set(n, 0);
      const cosmeticUnits: Record<number, number> = {};
      for (let n = 1; n <= 37; n++) {
        const real = realCounts.get(n) ?? 0;
        cosmeticUnits[n] = Math.floor(Math.random() * 3) + Math.round(real / 3);
      }
      for (const wn of winningCombo) {
        cosmeticUnits[wn] =
          (cosmeticUnits[wn] ?? 0) +
          Math.ceil(dummyUnits / 6) +
          Math.floor(Math.random() * 3);
      }
      const spikeCount = Math.floor(Math.random() * 3) + 2;
      const candNums = Array.from({ length: 37 }, (_, i) => i + 1).filter(
        (n) => !winningCombo.includes(n),
      );
      for (let i = 0; i < spikeCount; i++) {
        const idx = Math.floor(Math.random() * candNums.length);
        const sp = candNums.splice(idx, 1)[0];
        cosmeticUnits[sp] = Math.max(
          cosmeticUnits[sp] ?? 0,
          (cosmeticUnits[winningCombo[0]] ?? 0) +
            (Math.floor(Math.random() * 4) + 1),
        );
      }

      // If R > 0 and payoutToReal > 0, credit winners FIRST
      if (R > 0 && payoutToReal > 0) {
        const failedCredits: Array<{
          userId: string;
          bidId: string;
          reason: string;
        }> = [];

        // For JP, per-winner count is 1 (as you confirmed). Use unitPrizeRaw for fair calc
        const unitPrizeRaw = R + dummyUnits > 0 ? W / (R + dummyUnits) : 0;

        for (const b of winners) {
          const payoutRaw = unitPrizeRaw * 1;
          const payout = Number(payoutRaw.toFixed(2));

          if (payout <= 0) {
            failedCredits.push({
              userId: b.userId,
              bidId: b.id,
              reason: 'payout rounded to 0',
            });
            continue;
          }

          try {
            await this.walletService.creditWinning(b.userId, payout, {
              slotId: slot.id,
              bidId: b.id,
            });
          } catch (err: any) {
            console.error('creditWinning failed for JP', {
              userId: b.userId,
              bidId: b.id,
              err,
            });
            failedCredits.push({
              userId: b.userId,
              bidId: b.id,
              reason: String(err?.message ?? err),
            });
          }
        }

        if (failedCredits.length > 0) {
          throw new BadRequestException({
            message: 'Some winner credits failed',
            details: failedCredits,
          });
        }
      }

      // All credits (if any) succeeded. Persist draw and mark slot completed.
      const draw = await persistDraw({
        winner: winningCombo.join('-'),
        dummyUnits,
        totalUnits: R + dummyUnits,
        unitPrize,
        payoutTotal: payoutToReal,
        meta: {
          scaled,
          mode: 'JP',
          cosmeticUnits,
          credited: R > 0 && payoutToReal > 0 ? true : false,
        },
      });

      this.resultsStream.emit(draw);


      return { message: 'JP result announced', draw };
    }

    throw new BadRequestException('Unsupported slot type');
  }
}
