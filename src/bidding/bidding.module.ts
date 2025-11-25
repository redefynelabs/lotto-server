import { Module } from '@nestjs/common';
import { BiddingService } from './bidding.service';
import { BiddingController } from './bidding.controller';
import { PrismaService } from '../prisma/prisma.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],      
  controllers: [BiddingController],
  providers: [
    BiddingService,
    PrismaService,
  ],
  exports: [BiddingService],    
})
export class BiddingModule {}
