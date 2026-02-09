import { Module } from '@nestjs/common';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceController } from './intelligence.controller';
import { ResumeModule } from '../../resume/resume.module';

@Module({
  imports: [ResumeModule],
  providers: [IntelligenceService],
  controllers: [IntelligenceController],
})
export class IntelligenceModule {}
