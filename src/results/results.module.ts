import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ResultStreamService } from './results-stream.service';

@Module({
  imports: [PrismaModule],
  controllers: [ResultsController],
  providers: [ResultsService, ResultStreamService],
})
export class ResultsModule {}
