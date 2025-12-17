import { Module } from '@nestjs/common';
import { BiddingService } from './bidding.service';
import { BiddingController } from './bidding.controller';
import { PrismaService } from '../prisma/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { ResultStreamService } from 'src/results/results-stream.service';

@Module({
  imports: [WalletModule],      
  controllers: [BiddingController],
  providers: [
    BiddingService,
    PrismaService,
    ResultStreamService
  ],
  exports: [BiddingService],    
})
export class BiddingModule {}
