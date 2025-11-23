// src/wallet/wallet.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';
import { WalletTxType } from '@prisma/client';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  // ----------------------------
  // Utility: fetch wallet (throws if not exists)
  // ----------------------------
  async getWalletByUserId(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  // ----------------------------
  // Compute available funds for bidding:
  // available = totalBalance - reservedWinning
  // ----------------------------
  computeAvailable(wallet: {
    totalBalance: Decimal | number;
    reservedWinning: Decimal | number;
  }) {
    const total = Number(wallet.totalBalance);
    const reserved = Number(wallet.reservedWinning);
    return total - reserved;
  }

  // ----------------------------
  // Agent requests bidding deposit (creates a pending BID_CREDIT tx)
  // Admin must approve this request (approveDeposit)
  // ----------------------------
  async requestBidDeposit(
    userId: string,
    amount: number,
    transId: string,
    proofUrl?: string,
    note?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, totalBalance: 0, reservedWinning: 0 },
      });
    }

    const tx = await this.prisma.walletTx.create({
      data: {
        walletId: wallet.id,
        type: WalletTxType.BID_CREDIT,
        amount,
        balanceAfter: wallet.totalBalance,
        meta: {
          transId,
          proofUrl,
          note,
          status: 'PENDING',
          requestedBy: userId,
        },
      },
    });

    return { message: 'Deposit requested', tx };
  }

  // ----------------------------
  // Admin approves/declines the deposit request created above
  // ----------------------------
  async approveDeposit(
    adminId: string,
    walletTxId: string,
    approve: boolean,
    adminNote?: string,
  ) {
    const pending = await this.prisma.walletTx.findUnique({
      where: { id: walletTxId },
    });
    if (!pending) throw new NotFoundException('Deposit transaction not found');
    if (pending.type !== WalletTxType.BID_CREDIT)
      throw new BadRequestException('Transaction is not a deposit request');

    const meta = (pending.meta || {}) as Record<string, any>;

    if (!approve) {
      const updated = await this.prisma.walletTx.update({
        where: { id: walletTxId },
        data: {
          meta: {
            ...meta,
            status: 'DECLINED',
            approvedBy: adminId,
            adminNote,
          },
        },
      });
      return { message: 'Deposit declined', tx: updated };
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { id: pending.walletId },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const newTotal = Number(wallet.totalBalance) + Number(pending.amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const updatedTx = await tx.walletTx.update({
        where: { id: walletTxId },
        data: {
          balanceAfter: newTotal,
          meta: {
            ...meta,
            status: 'APPROVED',
            processedBy: adminId,
            adminNote,
          },
        },
      });

      return {
        message: 'Deposit approved',
        tx: updatedTx,
        wallet: { totalBalance: newTotal },
      };
    });
  }

  // ----------------------------
  // Debit for a bid (BID_DEBIT)
  // Atomic and respects negative limit from app settings
  // ----------------------------
  async debitForBid(userId: string, amount: number, meta: any = {}) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const settings = await tx.appSettings.findFirst();
      if (!settings)
        throw new BadRequestException('App settings not configured');

      const negativeLimit = Number(settings.agentNegativeBalanceLimt);

      const total = Number(wallet.totalBalance);
      const reserved = Number(wallet.reservedWinning);
      const available = total - reserved;

      if (available - amount < -negativeLimit) {
        throw new BadRequestException(
          `Negative limit exceeded. Allowed: ${negativeLimit}`,
        );
      }

      const newTotal = total - amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const txRecord = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.BID_DEBIT,
          amount: -amount,
          balanceAfter: newTotal,
          meta,
        },
      });

      return {
        message: 'Bid debited',
        wallet: {
          totalBalance: newTotal,
          reservedWinning: reserved,
          available: newTotal - reserved,
        },
        tx: txRecord,
      };
    });
  }

  // ----------------------------
  // Commission auto credit (COMMISSION_CREDIT)
  // Called by bidding flow when commission is computed.
  // This *credits* agent wallet immediately (reduces negative debt if any).
  // ----------------------------
  async creditCommission(userId: string, amount: number, meta: any = {}) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId, totalBalance: 0, reservedWinning: 0 },
        });
      }

      const prevTotal = Number(wallet.totalBalance);
      const reserved = Number(wallet.reservedWinning);

      const newTotal = prevTotal + amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const commissionTx = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.COMMISSION_CREDIT,
          amount,
          balanceAfter: newTotal,
          meta,
        },
      });

      return {
        message: 'Commission credited',
        wallet: {
          totalBalance: newTotal,
          reservedWinning: reserved,
          available: newTotal - reserved,
        },
        tx: commissionTx,
      };
    });
  }

  // ----------------------------
  // Admin settles commission to agent (COMMISSION_SETTLEMENT)
  // This represents company paying the credited commission to the agent (cash out).
  // It reduces the agent wallet (deducts from totalBalance).
  // ----------------------------
  async settleCommissionByAdmin(
    adminId: string,
    userId: string,
    amount: number,
    transId: string,
    note?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const total = Number(wallet.totalBalance);
      const reserved = Number(wallet.reservedWinning);
      const available = total - reserved;

      if (amount > available) {
        throw new BadRequestException(
          'Insufficient available balance to settle commission',
        );
      }

      const newTotal = total - amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const settlementTx = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.COMMISSION_SETTLEMENT,
          amount: -amount,
          balanceAfter: newTotal,
          meta: { transId, adminId, note },
        },
      });

      return {
        message: 'Commission settled (paid) by admin',
        tx: settlementTx,
        wallet: {
          totalBalance: newTotal,
          reservedWinning: reserved,
          available: newTotal - reserved,
        },
      };
    });
  }

  // ----------------------------
  // Winning reserved (WIN_CREDIT)
  // System marks winning as reserved (does NOT credit wallet.totalBalance)
  // ----------------------------
  async creditWinning(userId: string, amount: number, meta: any = {}) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const prevTotal = Number(wallet.totalBalance);
      let reserved = Number(wallet.reservedWinning);

      reserved += amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { reservedWinning: reserved },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.WIN_CREDIT,
          amount,
          balanceAfter: prevTotal,
          meta: { ...meta, note: 'winning reserved until admin payment' },
        },
      });

      return {
        message: 'Winning reserved',
        wallet: {
          totalBalance: prevTotal,
          reservedWinning: reserved,
          available: prevTotal - reserved,
        },
        tx: txRec,
      };
    });
  }

  // ----------------------------
  // Admin records WIN settlement -> company pays agent (WIN_SETTLEMENT_ADMIN_TO_AGENT)
  // This credits agent wallet (company paid).
  // ----------------------------
  async winningSettlementToAgent(
    adminId: string,
    userId: string,
    amount: number,
    transId: string,
    note?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const prevTotal = Number(wallet.totalBalance);
      const reserved = Number(wallet.reservedWinning);
      const newTotal = prevTotal + amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.WIN_SETTLEMENT_ADMIN_TO_AGENT,
          amount,
          balanceAfter: newTotal,
          meta: { transId, adminId, note },
        },
      });

      return {
        message: 'Winning amount credited to agent by admin',
        tx: txRec,
        wallet: {
          totalBalance: newTotal,
          reservedWinning: reserved,
          available: newTotal - reserved,
        },
      };
    });
  }

  // ----------------------------
  // Agent confirms they cleared the winning to the customer (WIN_SETTLEMENT_AGENT_TO_USER)
  // This reduces reservedWinning and reduces totalBalance by same amount.
  // ----------------------------
  async winningSettlementToUser(
    userId: string,
    amount: number,
    transId: string,
    proofUrl?: string,
    note?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      let total = Number(wallet.totalBalance);
      let reserved = Number(wallet.reservedWinning);

      if (reserved < amount)
        throw new BadRequestException('Reserved winning not enough');

      reserved -= amount;
      total -= amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: total, reservedWinning: reserved },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.WIN_SETTLEMENT_AGENT_TO_USER,
          amount: -amount,
          balanceAfter: total,
          meta: { transId, proofUrl, note },
        },
      });

      return {
        message: 'Winning settled to user by agent',
        wallet: {
          totalBalance: total,
          reservedWinning: reserved,
          available: total - reserved,
        },
        tx: txRec,
      };
    });
  }

  // ----------------------------
  // Admin processes agent withdraw (deduct balance)
  // ----------------------------
  async adminProcessWithdraw(
    adminId: string,
    userId: string,
    amount: number,
    transId: string,
    note?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const total = Number(wallet.totalBalance);
      const reserved = Number(wallet.reservedWinning);
      const available = total - reserved;

      if (amount > available)
        throw new BadRequestException(
          'Withdraw amount exceeds available balance',
        );

      const newTotal = total - amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.WITHDRAW,
          amount: -amount,
          balanceAfter: newTotal,
          meta: { transId, adminId, note },
        },
      });

      return {
        message: 'Withdraw processed',
        wallet: {
          totalBalance: newTotal,
          reservedWinning: reserved,
          available: newTotal - reserved,
        },
        tx: txRec,
      };
    });
  }

  // ----------------------------
  // Get wallet balance + commission fields
  // ----------------------------
  async getWalletBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const total = Number(wallet.totalBalance);
    const reserved = Number(wallet.reservedWinning);
    const available = total - reserved;

    const commissionAgg = await this.prisma.walletTx.aggregate({
      where: { walletId: wallet.id, type: WalletTxType.COMMISSION_CREDIT },
      _sum: { amount: true },
    });
    const commissionEarned = Number(commissionAgg._sum.amount || 0);

    const commissionSettledAgg = await this.prisma.walletTx.aggregate({
      where: { walletId: wallet.id, type: WalletTxType.COMMISSION_SETTLEMENT },
      _sum: { amount: true },
    });
    // commission settlement amounts are stored as negative amounts (we created -amount)
    const commissionSettled = Math.abs(
      Number(commissionSettledAgg._sum.amount || 0),
    );

    const commissionPending = commissionEarned - commissionSettled;

    return {
      totalBalance: total,
      reservedWinning: reserved,
      availableBalance: available,
      commissionEarned,
      commissionSettled,
      commissionPending,
    };
  }

  // ----------------------------
  // Get pending deposits (admin)
  // ----------------------------
  async getPendingDeposits() {
    return this.prisma.walletTx.findMany({
      where: {
        type: WalletTxType.BID_CREDIT,
        meta: { path: ['status'], equals: 'PENDING' },
      },
      orderBy: { createdAt: 'desc' },
      include: { wallet: { include: { user: true } } },
    });
  }

  // ----------------------------
  // Get wallet tx history (paginated)
  // ----------------------------
  async getWalletHistory(userId: string, page = 1, pageSize = 50) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const skip = (page - 1) * pageSize;

    const items = await this.prisma.walletTx.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    });

    const total = await this.prisma.walletTx.count({
      where: { walletId: wallet.id },
    });

    return { items, total, page, pageSize };
  }

  // ----------------------------
  // Commission summary for admin
  // - earned: sum(COMMISSION_CREDIT)
  // - settled: abs(sum(COMMISSION_SETTLEMENT)) (we store them as negative amounts)
  // - pending = earned - settled
  // - walletBalance is the agent wallet totalBalance
  // - if agent wallet negative, pending is locked (admin cannot pay)
  // ----------------------------
  async getCommissionSummary() {
    const agents = await this.prisma.user.findMany({
      where: { role: 'AGENT', isApproved: true },
      include: { wallet: true },
    });

    const result: Array<{
      agentId: string;
      name: string;
      earned: number;
      settled: number;
      pending: number;
      lockedPending: number;
      walletBalance: number;
    }> = [];

    for (const a of agents) {
      const wallet = a.wallet?.[0];
      const balance = wallet ? Number(wallet.totalBalance) : 0;

      const earnedAgg = await this.prisma.walletTx.aggregate({
        where: {
          walletId: wallet?.id || '',
          type: WalletTxType.COMMISSION_CREDIT,
        },
        _sum: { amount: true },
      });

      const settledAgg = await this.prisma.walletTx.aggregate({
        where: {
          walletId: wallet?.id || '',
          type: WalletTxType.COMMISSION_SETTLEMENT,
        },
        _sum: { amount: true },
      });

      const earned = Number(earnedAgg._sum.amount || 0);
      const settled = Math.abs(Number(settledAgg._sum.amount || 0));

      const fullPending = earned - settled;
      let pending = fullPending;
      let lockedPending = 0;

      if (balance < 0) {
        // if wallet is negative, admin cannot settle — lock pending
        lockedPending = fullPending;
        pending = 0;
      }

      result.push({
        agentId: a.id,
        name:
          `${a.firstName || ''} ${a.lastName || ''}`.trim() ||
          a.phone ||
          a.email ||
          a.id,
        earned,
        settled,
        pending,
        lockedPending,
        walletBalance: balance,
      });
    }

    return result;
  }

  async getPendingWinningSettlements() {
    return this.prisma.wallet
      .findMany({
        where: {
          reservedWinning: { gt: 0 },
          user: { role: 'AGENT', isApproved: true },
        },
        include: {
          user: true,
        },
      })
      .then((list) =>
        list.map((w) => ({
          agentId: w.userId,
          name: w.user.firstName + ' ' + w.user.lastName,
          phone: w.user.phone,
          reservedWinning: Number(w.reservedWinning),
          walletBalance: Number(w.totalBalance),
          pending: Number(w.reservedWinning), // admin must pay this
        })),
      );
  }
}
