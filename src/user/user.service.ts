import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { WalletService } from '../wallet/wallet.service';
import { Role } from '@prisma/client';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  // -------------------------------------------------------
  // User: Get my profile
  // -------------------------------------------------------
  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        dob: true,
        gender: true,
        role: true,
        isApproved: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  // -------------------------------------------------------
  // User: Update my details
  // -------------------------------------------------------
  async updateMyProfile(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dob: true,
        gender: true,
      },
    });
  }

  // -------------------------------------------------------
  // User: Get my wallet balance
  // -------------------------------------------------------
  async getMyWallet(userId: string) {
    return this.walletService.getWalletBalance(userId);
  }

  // -------------------------------------------------------
  // Admin: Update Agent Commission Percentage
  // -------------------------------------------------------
  async updateAgentCommission(userId: string, commissionPct: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found');

    if (user.role !== Role.AGENT) {
      throw new BadRequestException('Only agents can have commission updated');
    }

    if (!user.isApproved) {
      throw new BadRequestException(
        'Agent must be approved before updating commission',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { commissionPct },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        commissionPct: true,
        isApproved: true,
      },
    });
  }

  // -------------------------------------------------------
  // Admin: Get all users
  // -------------------------------------------------------
  async getAllUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------
  // Admin: Get approved agents
  // -------------------------------------------------------
  async getApprovedAgents() {
    return this.prisma.user.findMany({
      where: {
        role: Role.AGENT,
        isApproved: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------
  // Admin: Get unapproved agents
  // -------------------------------------------------------
  async getPendingAgents() {
    return this.prisma.user.findMany({
      where: {
        role: Role.AGENT,
        isApproved: false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -------------------------------------------------------
  // Admin: Approve an agent
  // -------------------------------------------------------
  async approveAgent(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role !== Role.AGENT)
      throw new BadRequestException('Only agents can be approved');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isApproved: true },
    });
  }

  // -------------------------------------------------------
  // Admin: Delete an user
  // -------------------------------------------------------
  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return { message: 'User deleted with all account related data' };
  }
}
