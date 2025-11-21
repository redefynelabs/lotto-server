import { IsString, IsUUID, IsBoolean, IsOptional } from 'class-validator';

export class ApproveDepositDto {
  @IsUUID()
  walletTxId: string; // Tx created by agent deposit request (pending entry)

  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  adminNote?: string;
}
