import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SlotService } from './slot.service';
import { CreateSlotDto } from './dto/create-slot.dto';
import { AdminUpdateSlotSettingsDto } from './dto/admin-update-slot-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('slots')
export class SlotController {
  constructor(private readonly slotService: SlotService) {}

  // Admin: create slot manually
  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  create(@Body() dto: CreateSlotDto) {
    return this.slotService.createSlot(dto);
  }

  // Admin: update slot manually
  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  update(@Param('id') id: string, @Body() dto: AdminUpdateSlotSettingsDto) {
    return this.slotService.updateSlot(id, dto);
  }

  // Admin: generate rolling future slots
  @Post('generate')
  @UseGuards(JwtAuthGuard, AdminGuard)
  generate() {
    return this.slotService.generateFutureSlots();
  }

  @Get('grouped-by-date')
  async getSlotsGroupedByDate() {
    return this.slotService.getSlotsGroupedByMalaysiaDate();
  }

  // Public: get all slots
  @Get('all')
  getAll() {
    return this.slotService.getAllSlots();
  }
  // Public: get upcoming open slots
  @Get('active')
  getActive() {
    return this.slotService.getActiveSlots();
  }

  @Get('active/ld')
  getActiveLd() {
    return this.slotService.getActiveLdSlots();
  }

  @Get('active/jp')
  getActiveJp() {
    return this.slotService.getActiveJpSlots();
  }
}
