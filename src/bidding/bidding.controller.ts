import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { BiddingService } from './bidding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CreateBidDto } from './dto/create-bid.dto';
import { AnnounceResultDto } from './dto/announce-result.dto';

@Controller('bids')
export class BiddingController {
  constructor(private biddingService: BiddingService) {}

  // Agent places bid
  @Post('create')
  @UseGuards(JwtAuthGuard)
  async createBid(@Req() req, @Body() dto: CreateBidDto) {
    const agentId = req.user.userId;
    return this.biddingService.createBid(agentId, dto);
  }

  
  // limits removed and route commented
  
  // @Get('remaining')
  // @UseGuards(JwtAuthGuard)
  // async getRemaining(
  //   @Query('slotId') slotId: string,
  //   @Query('number') number: string,
  // ) {
  //   return this.biddingService.getRemainingCount(slotId, Number(number));
  // }

  // Agent -> list my bids
  @Get('my')
  @UseGuards(JwtAuthGuard)
  async myBids(
    @Req() req,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.biddingService.getMyBids(
      req.user.userId,
      Number(page),
      Number(pageSize),
    );
  }

  // Public / admin -> list by slot
  @Get('slot/:slotId')
  @UseGuards(JwtAuthGuard, AdminGuard) // admin only for full view
  async getBySlot(@Param('slotId') slotId: string) {
    return this.biddingService.getBidsBySlot(slotId);
  }

  @Get('summary/:slotId')
  async getBidSummary(@Param('slotId') slotId: string) {
    return this.biddingService.getBidSummary(slotId);
  }

  // Admin announces result for slot
  @Post('announce')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async announceResult(@Req() req, @Body() dto: AnnounceResultDto) {
    return this.biddingService.announceResult(req.user.userId, dto);
  }
}
