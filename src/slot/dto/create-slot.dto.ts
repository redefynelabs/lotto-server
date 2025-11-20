import { IsEnum, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';
import { SlotType } from '@prisma/client';

export class CreateSlotDto {
  @IsEnum(SlotType)
  type: SlotType;

  @IsDateString()
  slotTime: string;

  @IsOptional()
  settingsJson?: any;
}
