import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get('MINIO_BUCKET', 'fluentops');
    const accessKey = this.config.get<string>('MINIO_ACCESS_KEY');
    const secretKey = this.config.get<string>('MINIO_SECRET_KEY');
    if (this.config.get<string>('NODE_ENV') === 'production' && (!accessKey || !secretKey)) {
      throw new Error(
        'MINIO_ACCESS_KEY and MINIO_SECRET_KEY must be set in production',
      );
    }
    this.client = new Minio.Client({
      endPoint: this.config.get('MINIO_ENDPOINT', 'localhost'),
      port: parseInt(this.config.get('MINIO_PORT', '9000'), 10),
      useSSL: this.config.get('MINIO_USE_SSL', 'false') === 'true',
      accessKey: accessKey || 'minio',
      secretKey: secretKey || 'minio123456',
    });
  }

  async onModuleInit() {
    try {
      await this.ensureBucketExists();
    } catch (err) {
      this.logger.warn('MinIO not available - skipped bucket init', err instanceof Error ? err.message : err);
    }
  }

  async getStatus(): Promise<'up' | 'down'> {
    try {
      await this.ensureBucketExists();
      return 'up';
    } catch (err) {
      this.logger.warn(`MinIO health probe failed: ${err instanceof Error ? err.message : err}`);
      return 'down';
    }
  }

  async presignedPutUrl(objectKey: string, ttl = 600): Promise<string> {
    return this.client.presignedPutObject(this.bucket, objectKey, ttl);
  }

  async presignedGetUrl(objectKey: string, ttl = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, objectKey, ttl);
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }

  async statObject(objectKey: string): Promise<Minio.BucketItemStat> {
    return this.client.statObject(this.bucket, objectKey);
  }

  private async ensureBucketExists(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }
}
