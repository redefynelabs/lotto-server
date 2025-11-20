import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { SlotStatus } from '@prisma/client';

export class AdminUpdateSlotSettingsDto {
  @IsOptional()
  @IsDateString()
  slotTime?: string;

  @IsOptional()
  settingsJson?: any;

  @IsOptional()
  @IsEnum(SlotStatus)
  status?: SlotStatus;
}
