import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma';
import { MinioService } from './minio.service';
import { PresignDto, CompleteUploadDto } from './dto';
import { PaginationDto } from '../common/pagination.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private static readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    private config: ConfigService,
  ) {}

  async presign(userId: string, dto: PresignDto) {
    const safeName = dto.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const objectKey = `recordings/${userId}/${Date.now()}-${safeName}`;
    const uploadUrl = await this.minio.presignedPutUrl(objectKey);
    const fileUrl = this.buildFileUrl(objectKey);
    return { uploadUrl: this.rewritePresignedUrl(uploadUrl), objectKey, fileUrl };
  }

  async complete(userId: string, dto: CompleteUploadDto) {
    if (!dto.objectKey.startsWith(`recordings/${userId}/`)) {
      throw new ForbiddenException('Object key does not belong to user');
    }

    const existing = await this.prisma.recording.findUnique({
      where: { objectKey: dto.objectKey },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ForbiddenException('Object key does not belong to user');
      }
      return {
        id: existing.id,
        url: this.buildFileUrl(existing.objectKey),
        createdAt: existing.createdAt,
      };
    }

    let stat;
    try {
      stat = await this.minio.statObject(dto.objectKey);
    } catch (err) {
      this.logger.warn(`Could not stat uploaded object ${dto.objectKey}: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException('Uploaded file not found');
    }

    if (stat.size > MediaService.MAX_FILE_SIZE) {
      try {
        await this.minio.deleteObject(dto.objectKey);
      } catch (deleteErr) {
        this.logger.warn(`Failed to remove oversized object ${dto.objectKey}: ${deleteErr instanceof Error ? deleteErr.message : deleteErr}`);
      }
      throw new BadRequestException(`File exceeds maximum size of ${MediaService.MAX_FILE_SIZE} bytes`);
    }

    const recording = await this.prisma.recording.create({
      data: {
        userId,
        objectKey: dto.objectKey,
        mimeType: dto.mimeType || 'audio/webm',
        sizeBytes: stat.size,
        durationMs: dto.durationMs,
        status: 'UPLOADED',
      },
    });

    return {
      id: recording.id,
      url: this.buildFileUrl(recording.objectKey),
      createdAt: recording.createdAt,
    };
  }

  async list(userId: string, pagination?: PaginationDto) {
    const recordings = await this.prisma.recording.findMany({
      where: { userId, status: 'UPLOADED' },
      orderBy: { createdAt: 'desc' },
      skip: pagination?.skip ?? 0,
      take: pagination?.take ?? 20,
    });
    return recordings.map((r) => ({
      ...r,
      url: this.buildFileUrl(r.objectKey),
    }));
  }

  async detail(userId: string, id: string) {
    const recording = await this.prisma.recording.findFirst({
      where: { id, userId },
    });
    if (!recording) throw new NotFoundException('Recording not found');

    const playUrl = this.rewritePresignedUrl(await this.minio.presignedGetUrl(recording.objectKey));
    return { ...recording, playUrl };
  }

  private rewritePresignedUrl(signedUrl: string): string {
    const publicUrl = this.publicObjectBaseUrl();
    if (!publicUrl) {
      return signedUrl;
    }

    try {
      const signed = new URL(signedUrl);
      const target = new URL(`${publicUrl}/`);
      const basePath = target.pathname.replace(/\/+$/, '');
      target.pathname = `${basePath}/${signed.pathname.replace(/^\/+/, '')}`;
      target.search = signed.search;
      return target.toString();
    } catch (error) {
      this.logger.warn(`Could not rewrite presigned MinIO URL: ${error instanceof Error ? error.message : error}`);
      return signedUrl;
    }
  }

  private buildFileUrl(objectKey: string): string {
    const publicUrl = this.publicObjectBaseUrl();
    if (publicUrl) {
      const bucket = this.config.get('MINIO_BUCKET', 'fluentops');
      return `${publicUrl}/${bucket}/${objectKey}`;
    }
    // fallback: construct from endpoint
    const endpoint = this.config.get('MINIO_ENDPOINT', 'localhost');
    const port = this.config.get('MINIO_PORT', '9000');
    const bucket = this.config.get('MINIO_BUCKET', 'fluentops');
    return `http://${endpoint}:${port}/${bucket}/${objectKey}`;
  }

  private publicObjectBaseUrl(): string | null {
    const publicUrl = this.config.get<string>('MINIO_PUBLIC_URL');
    if (!publicUrl) {
      return null;
    }
    return publicUrl.replace(/\/+$/, '');
  }
}
