import { IsString, IsNotEmpty, IsNumber } from 'class-validator';

export class ApproveAgentDto {
  @IsString()
  @IsNotEmpty()
  agentId: string;
}
