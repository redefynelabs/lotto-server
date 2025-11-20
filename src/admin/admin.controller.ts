import { Controller, Patch, Body, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApproveAgentDto } from './dto/approve-agent.dto';
import { AdminService } from './admin.service';

@Controller('admin/agents')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Patch('approve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async approveAgent(@Body() dto: ApproveAgentDto) {
    return this.adminService.approveAgent(dto);
  }
}
