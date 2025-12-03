import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  phone: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsString()
  ip?: string;
}
