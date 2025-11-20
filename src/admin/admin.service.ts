import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveAgentDto } from './dto/approve-agent.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async approveAgent(dto: ApproveAgentDto) {
    const agent = await this.prisma.user.findUnique({
      where: { id: dto.agentId },
    });

    if (!agent || agent.role !== 'AGENT') {
      throw new BadRequestException('Agent not found');
    }

    // Update approval and commission
    const updated = await this.prisma.user.update({
      where: { id: dto.agentId },
      data: {
        isApproved: true,
      },
    });
 
    // Ensure wallets are created if missing
    await this.prisma.biddingWallet.upsert({
      where: { userId: dto.agentId },
      update: {},
      create: { userId: dto.agentId },
    });

    await this.prisma.earningWallet.upsert({
      where: { userId: dto.agentId },
      update: {},
      create: { userId: dto.agentId },
    });

    return {
      message: 'Agent approved successfully',
      agent: updated,
    };
  }
}
