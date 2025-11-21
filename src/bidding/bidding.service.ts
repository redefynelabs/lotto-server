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

  // announce result for a slot (admin)
  // This will compute winners, apply loss-prevention for LD, and call walletService.creditWinning(userId, payout, meta)
  async announceResult(adminId: string, dto: AnnounceResultDto) {
    const slot = await this.prisma.slot.findUnique({
      where: { id: dto.slotId },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    if (slot.status !== 'OPEN' && slot.status !== 'CLOSED') {
      throw new BadRequestException(
        'Slot is not in a valid state for announcing result',
      );
    }

    // fetch settings
    const settings = await this.prisma.appSettings.findFirst();
    if (!settings) throw new BadRequestException('App settings not configured');

    if (slot.type === 'LD') {
      if (dto.winningNumber == null)
        throw new BadRequestException('winningNumber required for LD');

      const winningNumber = dto.winningNumber;

      // total units bid on winning number (real units)
      const aggUnits = await this.prisma.bid.aggregate({
        _sum: { count: true },
        where: { slotId: slot.id, number: winningNumber },
      });
      const realUnits = aggUnits._sum?.count ? Number(aggUnits._sum.count) : 0;

      // total collected for the slot (all bids amount)
      const aggCollected = await this.prisma.bid.aggregate({
        _sum: { amount: true },
        where: { slotId: slot.id },
      });
      const collectedTotal = aggCollected._sum?.amount
        ? Number(aggCollected._sum.amount)
        : 0;

      // winning prize (single winning pool)
      const winningPrize = Number(settings.winningPrizeLD);

      // Loss prevention: find smallest dummyUnits (0..(80-realUnits)) so that:
      // payoutToReal = (winningPrize / (realUnits + dummyUnits)) * realUnits <= collectedTotal
      // if realUnits == 0 -> no real winners, we still may need to reserve nothing.
      let dummyUnits = 0;
      let unitPrize = 0;
      let payoutToReal = 0;
      const maxUnitsPerNumber = 80;

      if (realUnits > 0) {
        const maxDummy = Math.max(0, maxUnitsPerNumber - realUnits);
        let found = false;
        for (let d = 0; d <= maxDummy; d++) {
          const totalUnits = realUnits + d;
          const candidateUnitPrize = winningPrize / totalUnits;
          const candidatePayoutToReal = candidateUnitPrize * realUnits;
          if (candidatePayoutToReal <= collectedTotal) {
            dummyUnits = d;
            unitPrize = candidateUnitPrize;
            payoutToReal = candidatePayoutToReal;
            found = true;
            break;
          }
        }
        if (!found) {
          // if we couldn't make company profitable by adding dummy units, choose d = maxDummy and compute unit
          dummyUnits = maxDummy;
          unitPrize = winningPrize / (realUnits + dummyUnits);
          payoutToReal = unitPrize * realUnits;
        }
      } else {
        // no real winners -> nothing to reserve. still record the draw result
        dummyUnits = 0;
        unitPrize = 0;
        payoutToReal = 0;
      }

      // record DrawResult
      const draw = await this.prisma.drawResult.create({
        data: {
          slotId: slot.id,
          winner: String(winningNumber),
          dummyUnits,
          totalUnits: realUnits + dummyUnits,
          perUnitPayout: unitPrize,
          payoutTotal: payoutToReal,
          meta: { adminId, note: dto.note },
        },
      });

      // for each winning bid, compute actual payout = unitPrize * bid.count
      if (realUnits > 0) {
        const winningBids = await this.prisma.bid.findMany({
          where: { slotId: slot.id, number: winningNumber },
        });

        for (const b of winningBids) {
          const payout = Number((unitPrize * Number(b.count)).toFixed(2));
          // Reserve the payout for the agent (WIN_CREDIT => reserve)
          await this.walletService.creditWinning(b.userId, payout, {
            slotId: slot.id,
            bidId: b.id,
            number: winningNumber,
          });
        }
      }

      // mark slot completed
      await this.prisma.slot.update({
        where: { id: slot.id },
        data: { status: 'COMPLETED' },
      });

      return { message: 'LD result announced', draw };
    }

    // ----------------------------
    // JP announce logic
    // ----------------------------
    if (slot.type === 'JP') {
      if (!dto.winningCombo)
        throw new BadRequestException('winningCombo required for JP');
      const winningCombo = this.parseComboString(dto.winningCombo);
      if (winningCombo.length !== 6)
        throw new BadRequestException('winningCombo must have 6 numbers');

      // find matching bids
      const allBids = await this.prisma.bid.findMany({
        where: { slotId: slot.id },
      });

      // iterate to find exact matches
      const winners = allBids.filter((b) => {
        if (!b.jpNumbers || b.jpNumbers.length !== 6) return false;
        // exact match order-sensitive? You said "combo matches" — we'll do order-insensitive match (sort both)
        const a = [...b.jpNumbers].map(Number).sort((x, y) => x - y);
        const w = [...winningCombo].map(Number).sort((x, y) => x - y);
        return a.join(',') === w.join(',');
      });

      // record draw result (store winner as normalized string)
      const draw = await this.prisma.drawResult.create({
        data: {
          slotId: slot.id,
          winner: winningCombo.join('-'),
          dummyUnits: 0,
          totalUnits: winners.length,
          perUnitPayout: Number(settings.winningPrizeJP) || 0,
          payoutTotal: winners.length * Number(settings.winningPrizeJP),
          meta: { adminId, note: dto.note },
        },
      });

      // for each winner reserve the winning amount (for JP it's whole winningPrizeJP per win)
      for (const w of winners) {
        const payout = Number(settings.winningPrizeJP);
        await this.walletService.creditWinning(w.userId, payout, {
          slotId: slot.id,
          bidId: w.id,
          jpNumbers: w.jpNumbers,
        });
      }

      await this.prisma.slot.update({
        where: { id: slot.id },
        data: { status: 'COMPLETED' },
      });

      return {
        message: 'JP result announced',
        draw,
        winnersCount: winners.length,
      };
    }

    throw new BadRequestException('Unsupported slot type');
  }
}
