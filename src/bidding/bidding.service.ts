import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateBidDto } from './dto/create-bid.dto';
import { AnnounceResultDto } from './dto/announce-result.dto';

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
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
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
      const agg = await this.prisma.bid.aggregate({
        _sum: { count: true },
        where: { slotId: dto.slotId, number: dto.number },
      });
      const currentUnits = agg._sum?.count ? Number(agg._sum.count) : 0;
      const maxUnitsPerNumber = Number(settings.ldBidLimitPerNumber);
      if (currentUnits + dto.count > maxUnitsPerNumber) {
        throw new BadRequestException(
          `Max ${maxUnitsPerNumber} units allowed per number in this slot. Remaining: ${Math.max(0, maxUnitsPerNumber - currentUnits)}`,
        );
      }

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
  async getRemainingCount(slotId: string, number: number) {
    const settings = await this.prisma.appSettings.findFirst();
    if (!settings) throw new BadRequestException('Settings missing');

    const maxCount = Number(settings.ldBidLimitPerNumber); // or make separate config like maxLdCount

    // total bids so far
    const total = await this.prisma.bid.aggregate({
      where: { slotId, number },
      _sum: { count: true },
    });

    const used = Number(total._sum.count || 0);
    const remaining = Math.max(maxCount - used, 0);

    return {
      number,
      used,
      maxCount,
      remaining,
    };
  }

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

    // ------------------------
    // Load app settings
    // ------------------------
    const settings = await this.prisma.appSettings.findFirst();
    if (!settings) throw new BadRequestException('App settings not configured');

    // use DB value or default 15% if not present
    const minProfitPct = Number(settings.minProfitPct ?? 0.15);

    const maxPerNumber = Number(settings.ldBidLimitPerNumber ?? 120);

    // sum total amount collected for slot
    const aggCollected = await this.prisma.bid.aggregate({
      where: { slotId: slot.id },
      _sum: { amount: true },
    });
    const collected = Number(aggCollected._sum.amount ?? 0);

    // profit threshold
    const minProfit = Number((collected * minProfitPct).toFixed(2));
    const maxAllowedPayout = Number((collected - minProfit).toFixed(2));

    // ------------------------------------
    // Helper: save draw result
    // ------------------------------------
    const saveDraw = async (params: {
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

    // ===============================================================
    // ======================= LUCKY DRAW =============================
    // ===============================================================
    if (slot.type === 'LD') {
      const W = Number(settings.winningPrizeLD ?? 0);

      if (dto.winningNumber == null)
        throw new BadRequestException('winningNumber required for LD');

      const winningNumber = dto.winningNumber;

      // count real units
      const aggUnits = await this.prisma.bid.aggregate({
        _sum: { count: true },
        where: { slotId: slot.id, number: winningNumber },
      });

      const R = Number(aggUnits._sum.count ?? 0);

      let dummyUnits = 0;
      let unitPrize = 0;
      let payoutToReal = 0;
      let scaled = false;

      if (R > 0) {
        const M = maxAllowedPayout;

        if (M <= 0) {
          // no money to pay winners
          dummyUnits = 0;
          unitPrize = 0;
          payoutToReal = 0;
          scaled = true;
        } else {
          const D = Math.ceil((W * R) / M - R);
          dummyUnits = Math.max(0, D);

          if (R + dummyUnits > maxPerNumber) {
            // fallback → scale payout
            dummyUnits = 0;
            unitPrize = Number((M / R).toFixed(2));
            payoutToReal = Number((unitPrize * R).toFixed(2));
            scaled = true;
          } else {
            // normal dummy method
            unitPrize = Number((W / (R + dummyUnits)).toFixed(2));
            payoutToReal = Number((unitPrize * R).toFixed(2));
          }
        }
      } else {
        // No real winners → cosmetic dummy winners
        const p = Math.floor(Math.random() * (50 - 20 + 1)) + 20;
        dummyUnits = Math.ceil(W / p);

        if (dummyUnits > maxPerNumber) dummyUnits = maxPerNumber;

        unitPrize = Number((W / dummyUnits).toFixed(2));
        payoutToReal = 0;
      }

      // save result
      const draw = await saveDraw({
        winner: String(winningNumber),
        dummyUnits,
        totalUnits: R + dummyUnits,
        unitPrize,
        payoutTotal: payoutToReal,
        meta: { scaled, mode: 'LD' },
      });

      // credit winning payouts
      if (R > 0 && payoutToReal > 0) {
        const winningBids = await this.prisma.bid.findMany({
          where: { slotId: slot.id, number: winningNumber },
        });

        for (const b of winningBids) {
          const payout = Number((unitPrize * b.count).toFixed(2));
          await this.walletService.creditWinning(b.userId, payout, {
            slotId: slot.id,
            bidId: b.id,
          });
        }
      }

      return {
        message: 'LD result announced',
        draw,
      };
    }

    // ===============================================================
    // ======================= JACKPOT ================================
    // ===============================================================
    if (slot.type === 'JP') {
      if (!dto.winningCombo)
        throw new BadRequestException('winningCombo required for JP');

      const winningCombo = this.parseComboString(dto.winningCombo);

      if (winningCombo.length !== 6)
        throw new BadRequestException('Winning combo must have 6 numbers');

      const allBids = await this.prisma.bid.findMany({
        where: { slotId: slot.id },
      });

      const winners = allBids.filter((b) => {
        const a = [...b.jpNumbers].sort((x, y) => x - y);
        const w = [...winningCombo].sort((x, y) => x - y);
        return a.join(',') === w.join(',');
      });

      const R = winners.length;
      const W = Number(settings.winningPrizeJP ?? 0);
      const M = maxAllowedPayout;

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

          unitPrize = Number((W / (R + dummyUnits)).toFixed(2));
          payoutToReal = Number((unitPrize * R).toFixed(2));
        }
      } else {
        // Cosmetic dummy winners
        const p = Math.floor(Math.random() * (50 - 20 + 1)) + 20;
        dummyUnits = Math.ceil(W / p);
        unitPrize = Number((W / dummyUnits).toFixed(2));
        payoutToReal = 0;
      }

      const draw = await saveDraw({
        winner: winningCombo.join('-'),
        dummyUnits,
        totalUnits: R + dummyUnits,
        unitPrize,
        payoutTotal: payoutToReal,
        meta: { scaled, mode: 'JP' },
      });

      if (R > 0 && payoutToReal > 0) {
        for (const b of winners) {
          const payout = Number(unitPrize.toFixed(2)); // JP is per-ticket = 1 unit
          await this.walletService.creditWinning(b.userId, payout, {
            slotId: slot.id,
            bidId: b.id,
          });
        }
      }

      return {
        message: 'JP result announced',
        draw,
      };
    }

    throw new BadRequestException('Unsupported slot type');
  }
}
