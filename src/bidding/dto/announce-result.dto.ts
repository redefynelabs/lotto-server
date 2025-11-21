import { IsString, IsOptional } from 'class-validator';

export class AnnounceResultDto {
  @IsString()
  slotId: string;

  // for LD: winningNumber stringified or number (use number)
  @IsOptional()
  winningNumber?: number;

  // for JP: winning combo as comma-separated string or array — here accept string
  @IsOptional()
  winningCombo?: string; // "10-23-31-10-1-5" or "10,23,31,10,1,5"

  @IsOptional()
  @IsString()
  note?: string;
}
