import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/client';

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

    // ensure wallet exists
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      // create wallet record on demand
      wallet = await this.prisma.wallet.create({
        data: { userId, totalBalance: 0, reservedWinning: 0 },
      });
    }

    // create a pending deposit tx (we store it as a tx but don't change balance until admin approves)
    const tx = await this.prisma.walletTx.create({
      data: {
        walletId: wallet.id,
        type: 'BID_CREDIT',
        amount: amount,
        balanceAfter: wallet.totalBalance, // no change yet
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
  // If approve: apply amount to wallet.totalBalance and log final tx (BID_CREDIT approved)
  // If decline: update the pending tx meta to show declined
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
    if (pending.type !== 'BID_CREDIT')
      throw new BadRequestException('Transaction is not a deposit request');

    const meta = (pending.meta || {}) as Record<string, any>;

    if (!approve) {
      // simply update status and exit
      const updated = await this.prisma.walletTx.update({
        where: { id: walletTxId },
        data: {
          meta: {
            ...(meta as Record<string, any>),
            status: 'DECLINED',
            adminNote,
            approvedBy: adminId,
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

      // update wallet balance
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      // UPDATE SAME TRANSACTION (not creating a new one)
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
        wallet: {
          totalBalance: newTotal,
        },
      };
    });
  }

  // ----------------------------
  // Debit for a bid (BID_DEBIT)
  // This is used by bidding module when an agent places a bid.
  // It reduces totalBalance immediately (may go negative, but respect negativeLimit)
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
          type: 'BID_DEBIT',
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
  // Commission auto credit (COMMISSION_CREDIT) - system triggered
  // Simple model: credit directly to wallet (no separate debt adjust). BalanceAfter reflects new wallet.totalBalance.
  // ----------------------------
  async creditCommission(userId: string, amount: number, meta: any = {}) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      // ensure wallet exists
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId, totalBalance: 0, reservedWinning: 0 },
        });
      }

      const reserved = Number(wallet.reservedWinning);
      const prevTotal = Number(wallet.totalBalance);

      // New total after credit
      const newTotal = prevTotal + amount;

      // update wallet total
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      // record commission tx
      const commissionTx = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: 'COMMISSION_CREDIT',
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
  // Admin manually pays commission / topup (COMMISSION_PAID)
  // Simple model: credit directly to wallet.
  // ----------------------------
  async adminPayCommission(
    adminId: string,
    userId: string,
    amount: number,
    transId: string,
    note?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId, totalBalance: 0, reservedWinning: 0 },
        });
      }

      const reserved = Number(wallet.reservedWinning);
      const prevTotal = Number(wallet.totalBalance);

      const newTotal = prevTotal + amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: 'COMMISSION_PAID',
          amount,
          balanceAfter: newTotal,
          meta: { transId, adminId, note },
        },
      });

      return {
        message: 'Commission paid successfully',
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
  // Winning reserved (WIN_CREDIT)
  // System marks winning as reserved (does NOT credit wallet.totalBalance).
  // ----------------------------
  async creditWinning(userId: string, amount: number, meta: any = {}) {
    if (amount <= 0) throw new BadRequestException('Amount must be > 0');

    return this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const prevTotal = Number(wallet.totalBalance);
      let reserved = Number(wallet.reservedWinning);

      // reserve winning amount (doesn't touch totalBalance)
      reserved += amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { reservedWinning: reserved },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: 'WIN_CREDIT',
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
  // Admin records WIN_PAID (company paid agent) -> credit wallet totalBalance
  // ----------------------------
  async adminRecordWinPaid(
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

      const reserved = Number(wallet.reservedWinning);
      const prevTotal = Number(wallet.totalBalance);

      const newTotal = prevTotal + amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: newTotal },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: 'WIN_PAID',
          amount,
          balanceAfter: newTotal,
          meta: { transId, adminId, note },
        },
      });

      return {
        message: 'Winning credited to wallet',
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
  // Agent confirms they cleared the winning to the customer (WIN_CLEAR)
  // This reduces reservedWinning and reduces totalBalance by same amount.
  // ----------------------------
  async confirmWinClear(
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

      // Deduct both
      reserved -= amount;
      total -= amount;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { totalBalance: total, reservedWinning: reserved },
      });

      const txRec = await tx.walletTx.create({
        data: {
          walletId: wallet.id,
          type: 'WIN_CLEAR',
          amount: -amount,
          balanceAfter: total,
          meta: { transId, proofUrl, note },
        },
      });

      return {
        message: 'Winning cleared by agent',
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
  // Withdraw (admin processed): agent requests withdraw, admin processes by creating a tx that reduces totalBalance
  // This helper is to process a withdraw (admin action) — amount deducted from available only
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
          type: 'WITHDRAW',
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
  // Get wallet balance
  // ----------------------------
  async getWalletBalance(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');

    const total = Number(wallet.totalBalance);
    const reserved = Number(wallet.reservedWinning);
    const available = total - reserved;

    return {
      totalBalance: total,
      reservedWinning: reserved,
      availableBalance: available,
    };
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
}
