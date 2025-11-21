import { IsNumber, IsOptional, IsString } from 'class-validator';

export class ConfirmWinningDto {
  @IsNumber()
  amount: number;

  @IsString()
  transId: string;

  @IsString()
  @IsOptional()
  proofUrl?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
