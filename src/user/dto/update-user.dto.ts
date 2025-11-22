import { IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { Gender } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;
}
