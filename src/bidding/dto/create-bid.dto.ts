import { IsString, IsNumber, IsOptional, IsArray, ArrayMinSize } from 'class-validator';

export class CreateBidDto {
  @IsString()
  customerName: string;

  @IsString()
  customerPhone: string;

  @IsString()
  slotId: string;

  // For LD: number 1-37
  @IsOptional()
  @IsNumber()
  number?: number;

  // For LD: count of units
  @IsOptional()
  @IsNumber()
  count?: number;

  // For JP: six numbers array (each 1..37). Int[] allowed to be empty for LD
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  jpNumbers?: number[];

  // optional note
  @IsOptional()
  @IsString()
  note?: string;
}
