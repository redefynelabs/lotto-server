import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SlotModule } from './slot/slot.module';
import { SettingsModule } from './settings/settings.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WalletModule } from './wallet/wallet.module';
import { BiddingModule } from './bidding/bidding.module';
import { UserModule } from './user/user.module';
import { ResultsModule } from './results/results.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    SlotModule,
    SettingsModule,
    WalletModule,
    BiddingModule,
    UserModule,
    ResultsModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
