import { IsNumber, IsString, IsOptional } from 'class-validator';

export class CreateDepositDto {
  @IsNumber()
  amount: number;

  @IsString()
  transId: string;

  @IsOptional()
  @IsString()
  proofUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
