import { IsUUID } from 'class-validator';

export class GetResultDto {
  @IsUUID()
  slotId: string;
}
