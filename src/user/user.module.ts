import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Module({
  controllers: [UserController],
  providers: [UserService, PrismaService, WalletService],
  exports: [UserService],
})
export class UserModule {}
