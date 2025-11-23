import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AdminPayDto {
  @IsString()
  userId: string;

  @IsNumber()
  amount: number;

  @IsString()
  transId: string;

  @IsString()
  @IsOptional()
  note?: string;
}
