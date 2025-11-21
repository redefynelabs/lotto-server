import { Module } from '@nestjs/common';
import { BiddingService } from './bidding.service';
import { BiddingController } from './bidding.controller';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Module({
  controllers: [BiddingController],
  providers: [
    BiddingService,
    PrismaService,
    WalletService,
  ],
  exports: [BiddingService],
})
export class BiddingModule {}
