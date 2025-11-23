import { Controller, Get, Patch, Body, UseGuards, Param } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { UpdateCommissionDto } from './dto/update-commision.dto';

@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  // ------------------------------
  // User: My Profile
  // ------------------------------
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProfile(@GetUser('userId') userId: string) {
    return this.userService.getMyProfile(userId);
  }

  // ------------------------------
  // User: Update My Profile
  // ------------------------------
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMyProfile(
    @GetUser('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateMyProfile(userId, dto);
  }

  
  // ------------------------------
  // User: My Wallet
  // ------------------------------
  @UseGuards(JwtAuthGuard)
  @Get('me/wallet')
  getMyWallet(@GetUser('userId') userId: string) {
    return this.userService.getMyWallet(userId);
  }

  // ------------------------------
  // Admin: all users
  // ------------------------------
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/all')
  getAllUsers() {
    return this.userService.getAllUsers();
  }

  // ------------------------------
  // Admin: Approved Agents
  // ------------------------------
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/agents/approved')
  getApprovedAgents() {
    return this.userService.getApprovedAgents();
  }

  // ------------------------------
  // Admin: Pending Agents
  // ------------------------------
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/agents/pending')
  getPendingAgents() {
    return this.userService.getPendingAgents();
  }

  // ------------------------------
  // Admin: Approve Agent
  // ------------------------------
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/agents/:id/approve')
  approveAgent(@Param('id') userId: string) {
    return this.userService.approveAgent(userId);
  }

  @Patch('/admin/agents/:id/commission')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateAgentCommission(
    @Param('id') userId: string,
    @Body() dto: UpdateCommissionDto,
  ) {
    return this.userService.updateAgentCommission(userId, dto.commissionPct);
  }
}
