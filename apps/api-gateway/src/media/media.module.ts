import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MinioService } from './minio.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MinioService],
  exports: [MinioService],
})
export class MediaModule {}
