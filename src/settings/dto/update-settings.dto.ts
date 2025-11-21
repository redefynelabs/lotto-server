import { IsOptional, IsNumber, IsArray, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  slotAutoGenerateCount?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  defaultLdTimes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  defaultJpTimes?: string[];

  @IsOptional()
  @IsString()
  timezone;

  @IsOptional()
  @IsNumber()
  defaultCommissionPct?: number;

  @IsOptional()
  @IsNumber()
  agentNegativeBalanceLimt?: number;

  @IsOptional()
  @IsNumber()
  bidPrizeLD?: number;

  @IsOptional()
  @IsNumber()
  bidPrizeJP?: number;

  @IsOptional()
  @IsNumber()
  winningPrizeLD?: number;

  @IsOptional()
  @IsNumber()
  winningPrizeJP?: number;
}
