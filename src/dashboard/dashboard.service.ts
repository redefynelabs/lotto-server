import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const MY_TIMEZONE = 'Asia/Kuala_Lumpur';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /* ============================
     Agent summary (ACTIVE bids)
  ============================ */
  async getAgentSummary(agentId: string, days: number) {
    const fromDate =
      days === 0
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const bidWhere: any = {
      userId: agentId,
      status: 'ACTIVE', // ✅ ONLY ACTIVE
      ...(fromDate && { createdAt: { gte: fromDate } }),
    };

    // Total ACTIVE bids
    const totalBids = await this.prisma.bid.count({
      where: bidWhere,
    });

    // Total ACTIVE bid amount
    const bidAgg = await this.prisma.bid.aggregate({
      where: bidWhere,
      _sum: { amount: true },
    });
    const totalBidAmount = Number(bidAgg._sum.amount || 0);

    // Wallet
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: agentId },
    });

    // Commission earned
    const commissionAgg = await this.prisma.walletTx.aggregate({
      where: {
        walletId: wallet?.id,
        type: 'COMMISSION_CREDIT',
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      _sum: { amount: true },
    });
    const totalCommission = Number(commissionAgg._sum.amount || 0);

    // Winnings
    const winningAgg = await this.prisma.walletTx.aggregate({
      where: {
        walletId: wallet?.id,
        type: 'WIN_CREDIT',
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      _sum: { amount: true },
    });
    const totalWinnings = Number(winningAgg._sum.amount || 0);

    // Losses
    const totalLosses = Math.max(
      totalBidAmount - totalCommission - totalWinnings,
      0,
    );

    return {
      totalBids,
      totalCommission,
      totalWinnings,
      totalLosses,
    };
  }

  /* ============================
     Agent bid graph (MY dates)
  ============================ */
  async getAgentBidGraph(agentId: string, days: number) {
    const fromDate =
      days === 0
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const bids = await this.prisma.bid.findMany({
      where: {
        userId: agentId,
        status: 'ACTIVE', // ✅ ONLY ACTIVE
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      select: {
        createdAt: true,
      },
    });

    const map = new Map<string, number>();

    for (const b of bids) {
      // ✅ Convert to Malaysia date
      const myDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: MY_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(b.createdAt); // YYYY-MM-DD

      map.set(myDate, (map.get(myDate) || 0) + 1);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }

  /* =================================================
     ADMIN SUMMARY
  ================================================= */
  async getAdminSummary(days: number) {
    const fromDate =
      days === 0
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    /* ---------- Users ---------- */
    const totalUsers = await this.prisma.user.count();

    const approvedAgents = await this.prisma.user.count({
      where: {
        role: 'AGENT',
        isApproved: true,
      },
    });

    /* ---------- Bids ---------- */
    const bidWhere: any = {
      status: 'ACTIVE',
      ...(fromDate && { createdAt: { gte: fromDate } }),
    };

    const totalBids = await this.prisma.bid.count({
      where: bidWhere,
    });

    /* ---------- Revenue ----------
       Revenue = total bid amount - winnings paid
    -------------------------------- */
    const bidAgg = await this.prisma.bid.aggregate({
      where: bidWhere,
      _sum: { amount: true },
    });
    const totalBidAmount = Number(bidAgg._sum.amount || 0);

    const winningAgg = await this.prisma.walletTx.aggregate({
      where: {
        type: 'WIN_CREDIT',
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      _sum: { amount: true },
    });
    const totalWinningsPaid = Number(winningAgg._sum.amount || 0);

    const totalRevenue = Math.max(totalBidAmount - totalWinningsPaid, 0);

    return {
      totalUsers,
      approvedAgents,
      totalBids,
      totalRevenue,
    };
  }

  /* =================================================
     ADMIN BID GRAPH (DATE-WISE)
  ================================================= */
  async getAdminBidGraph(days: number) {
    const fromDate =
      days === 0
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const bids = await this.prisma.bid.findMany({
      where: {
        status: 'ACTIVE',
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      select: {
        createdAt: true,
      },
    });

    const map = new Map<string, number>();

    for (const b of bids) {
      // Malaysia date bucket
      const myDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: MY_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(b.createdAt); // YYYY-MM-DD

      map.set(myDate, (map.get(myDate) || 0) + 1);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }

  /* =========================================
     ADMIN: NET PROFIT + WIN/LOSS TREND
  ========================================= */
  async getAdminProfitTrend(days: number) {
    const fromDate =
      days === 0
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1️⃣ ACTIVE bids
    const bids = await this.prisma.bid.findMany({
      where: {
        status: 'ACTIVE',
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      select: {
        createdAt: true,
        amount: true,
      },
    });

    // 2️⃣ Wallet transactions
    const txs = await this.prisma.walletTx.findMany({
      where: {
        type: {
          in: ['WIN_CREDIT', 'COMMISSION_CREDIT'],
        },
        ...(fromDate && { createdAt: { gte: fromDate } }),
      },
      select: {
        type: true,
        amount: true,
        createdAt: true,
      },
    });

    const daily = new Map<
      string,
      { bid: number; win: number; commission: number }
    >();

    const getMYDate = (date: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: MY_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);

    // Aggregate bids
    for (const b of bids) {
      const d = getMYDate(b.createdAt);
      const row = daily.get(d) || { bid: 0, win: 0, commission: 0 };
      row.bid += Number(b.amount);
      daily.set(d, row);
    }

    // Aggregate winnings & commission
    for (const t of txs) {
      const d = getMYDate(t.createdAt);
      const row = daily.get(d) || { bid: 0, win: 0, commission: 0 };

      if (t.type === 'WIN_CREDIT') row.win += Number(t.amount);
      if (t.type === 'COMMISSION_CREDIT') row.commission += Number(t.amount);

      daily.set(d, row);
    }

    // Build response
    let totalBid = 0;
    let totalWin = 0;
    let totalCommission = 0;

    const trend = Array.from(daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        totalBid += v.bid;
        totalWin += v.win;
        totalCommission += v.commission;

        return {
          date,
          bidAmount: v.bid,
          winnings: v.win,
          commission: v.commission,
          netProfit: v.bid - v.win - v.commission,
        };
      });

    return {
      summary: {
        totalBidAmount: totalBid,
        totalWinnings: totalWin,
        totalCommission,
        netProfit: totalBid - totalWin - totalCommission,
      },
      trend,
    };
  }

  async getTopAgents(days: number, limit = 10) {
    const fromDate =
      days === 0
        ? undefined
        : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // 1️⃣ Get all approved agents
    const agents = await this.prisma.user.findMany({
      where: {
        role: 'AGENT',
        isApproved: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    const results: Array<{
      agentId: string;
      name: string;
      totalBids: number;
      totalBidAmount: number;
      totalWinnings: number;
      totalCommission: number;
      netContribution: number;
    }> = [];

    for (const agent of agents) {
      const bidWhere: any = {
        userId: agent.id,
        status: 'ACTIVE',
        ...(fromDate && { createdAt: { gte: fromDate } }),
      };

      // Bids
      const bidAgg = await this.prisma.bid.aggregate({
        where: bidWhere,
        _count: true,
        _sum: { amount: true },
      });

      const totalBids = bidAgg._count;
      const totalBidAmount = Number(bidAgg._sum.amount || 0);

      // Wallet
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: agent.id },
      });

      if (!wallet) continue;

      // Winnings
      const winAgg = await this.prisma.walletTx.aggregate({
        where: {
          walletId: wallet.id,
          type: 'WIN_CREDIT',
          ...(fromDate && { createdAt: { gte: fromDate } }),
        },
        _sum: { amount: true },
      });

      // Commission
      const commissionAgg = await this.prisma.walletTx.aggregate({
        where: {
          walletId: wallet.id,
          type: 'COMMISSION_CREDIT',
          ...(fromDate && { createdAt: { gte: fromDate } }),
        },
        _sum: { amount: true },
      });

      const totalWinnings = Number(winAgg._sum.amount || 0);
      const totalCommission = Number(commissionAgg._sum.amount || 0);

      const netContribution = totalBidAmount - totalWinnings - totalCommission;

      results.push({
        agentId: agent.id,
        name: `${agent.firstName} ${agent.lastName}`,
        totalBids,
        totalBidAmount,
        totalWinnings,
        totalCommission,
        netContribution,
      });
    }

    return results
      .sort((a, b) => b.netContribution - a.netContribution)
      .slice(0, limit);
  }
}
