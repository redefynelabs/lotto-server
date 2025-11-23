// src/wallet/wallet.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Query,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { ApproveDepositDto } from './dto/approve-deposit.dto';
import { ConfirmWinningDto } from './dto/confirm-winning.dto';
import { AdminPayDto } from './dto/admin-pay.dto';

@Controller('wallet')
export class WalletController {
  constructor(private walletService: WalletService) {}

  // Agent requests deposit (PENDING)
  @Post('deposit/request')
  @UseGuards(JwtAuthGuard)
  requestDeposit(@Req() req, @Body() dto: CreateDepositDto) {
    return this.walletService.requestBidDeposit(
      req.user.userId,
      dto.amount,
      dto.transId,
      dto.proofUrl,
      dto.note,
    );
  }

  // Admin approves/declines pending deposit
  @Post('deposit/approve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  approveDeposit(@Req() req, @Body() dto: ApproveDepositDto) {
    return this.walletService.approveDeposit(
      req.user.userId,
      dto.walletTxId,
      dto.approve,
      dto.adminNote,
    );
  }

  // Get wallet balance (agent or admin viewing own)
  @Get('balance')
  @UseGuards(JwtAuthGuard)
  async getMyBalance(@Req() req) {
    return this.walletService.getWalletBalance(req.user.userId);
  }

  // Wallet history (paginated)
  @Get('history')
  @UseGuards(JwtAuthGuard)
  history(
    @Req() req,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.walletService.getWalletHistory(
      req.user.userId,
      Number(page),
      Number(pageSize),
    );
  }

  // Admin: settle commission to agent (will deduct wallet balance, create COMMISSION_SETTLEMENT tx)
  @Post('admin/commission/settle-to-agent')
  @UseGuards(JwtAuthGuard, AdminGuard)
  settleCommission(@Req() req, @Body() dto: AdminPayDto) {
    return this.walletService.settleCommissionByAdmin(
      req.user.userId,
      dto.userId,
      dto.amount,
      dto.transId,
      dto.note,
    );
  }

  // Admin pays winning amount to agent (company -> agent) - credits agent wallet
  @Post('admin/win/settle-to-agent')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminWinPaid(@Req() req, @Body() dto: AdminPayDto) {
    return this.walletService.winningSettlementToAgent(
      req.user.userId,
      dto.userId,
      dto.amount,
      dto.transId,
      dto.note,
    );
  }

  // Agent confirms payout to customer (WIN_SETTLEMENT_AGENT_TO_USER)
  @Post('agent/win/settle-to-user')
  @UseGuards(JwtAuthGuard)
  confirmWinning(@Req() req, @Body() dto: ConfirmWinningDto) {
    return this.walletService.winningSettlementToUser(
      req.user.userId,
      dto.amount,
      dto.transId,
      dto.proofUrl,
      dto.note,
    );
  }

  // Admin processes agent withdraw (deduct balance)
  @Post('admin/withdraw')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminWithdraw(@Req() req, @Body() dto: any) {
    return this.walletService.adminProcessWithdraw(
      req.user.userId,
      dto.agentId,
      dto.amount,
      dto.transId,
      dto.note,
    );
  }

  // Admin: list pending deposit requests
  @Get('admin/deposits/pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getPendingDeposits() {
    return this.walletService.getPendingDeposits();
  }

  // Admin: commission summary
  @Get('admin/commission/summary')
  @UseGuards(JwtAuthGuard, AdminGuard)
  commissionSummary() {
    return this.walletService.getCommissionSummary();
  }

  @Get('admin/winning/pending')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAdminPendingWinning() {
    return this.walletService.getPendingWinningSettlements();
  }
}
