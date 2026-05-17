import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { PrismaService } from '../prisma';
import { MinioService } from './minio.service';
import { PresignDto, CompleteUploadDto } from './dto';

describe('MediaService', () => {
  let service: MediaService;
  let prisma: {
    recording: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let minio: {
    presignedPutUrl: jest.Mock;
    presignedGetUrl: jest.Mock;
    statObject: jest.Mock;
    deleteObject: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      recording: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    minio = {
      presignedPutUrl: jest.fn().mockResolvedValue('http://minio/put'),
      presignedGetUrl: jest.fn().mockResolvedValue('http://minio/get'),
      statObject: jest.fn().mockResolvedValue({ size: 100 }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ConfigService, useValue: { get: (k: string, d?: string) => d ?? '' } },
      ],
    }).compile();

    service = module.get(MediaService);
  });

  describe('presign', () => {
    it('sanitizes special chars in filename', async () => {
      const dto = Object.assign(new PresignDto(), { filename: 'héllo wörld!.webm', contentType: 'audio/webm' });
      const result = await service.presign('u1', dto);
      expect(result.objectKey).toMatch(/^recordings\/u1\/\d+-h_llo_w_rld_.webm$/);
    });

    it('truncates filename to 100 chars', async () => {
      const longName = 'a'.repeat(200) + '.webm';
      const dto = Object.assign(new PresignDto(), { filename: longName, contentType: 'audio/webm' });
      const result = await service.presign('u1', dto);
      const namePart = result.objectKey.split('/').pop()!;
      const sanitized = namePart.substring(namePart.indexOf('-') + 1);
      expect(sanitized.length).toBeLessThanOrEqual(100);
    });
  });

  describe('complete', () => {
    it('throws ForbiddenException for wrong user prefix', async () => {
      const dto = Object.assign(new CompleteUploadDto(), { objectKey: 'recordings/u2/file.webm', mimeType: 'audio/webm', sizeBytes: 100 });
      await expect(service.complete('u1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('creates recording on success', async () => {
      const rec = { id: 'r1', objectKey: 'recordings/u1/file.webm', createdAt: new Date() };
      prisma.recording.create.mockResolvedValue(rec);
      const dto = Object.assign(new CompleteUploadDto(), { objectKey: 'recordings/u1/file.webm', mimeType: 'audio/webm', sizeBytes: 100 });
      const result = await service.complete('u1', dto);
      expect(result.id).toBe('r1');
      expect(prisma.recording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sizeBytes: 100 }),
        }),
      );
    });

    it('throws when uploaded object does not exist', async () => {
      minio.statObject.mockRejectedValueOnce(new Error('not found'));
      const dto = Object.assign(new CompleteUploadDto(), { objectKey: 'recordings/u1/file.webm', mimeType: 'audio/webm', sizeBytes: 100 });
      await expect(service.complete('u1', dto)).rejects.toThrow('Uploaded file not found');
      expect(prisma.recording.create).not.toHaveBeenCalled();
    });

    it('returns existing recording when called twice with the same objectKey (idempotent)', async () => {
      const existing = {
        id: 'r1',
        userId: 'u1',
        objectKey: 'recordings/u1/file.webm',
        createdAt: new Date(),
      };
      prisma.recording.findUnique.mockResolvedValueOnce(existing);

      const dto = Object.assign(new CompleteUploadDto(), { objectKey: 'recordings/u1/file.webm', mimeType: 'audio/webm', sizeBytes: 100 });
      const result = await service.complete('u1', dto);

      expect(result.id).toBe('r1');
      expect(prisma.recording.create).not.toHaveBeenCalled();
      expect(minio.statObject).not.toHaveBeenCalled();
    });

    it('throws Forbidden when an existing recording belongs to another user', async () => {
      prisma.recording.findUnique.mockResolvedValueOnce({
        id: 'r1',
        userId: 'u2',
        objectKey: 'recordings/u1/file.webm',
        createdAt: new Date(),
      });

      const dto = Object.assign(new CompleteUploadDto(), { objectKey: 'recordings/u1/file.webm', mimeType: 'audio/webm', sizeBytes: 100 });
      await expect(service.complete('u1', dto)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('list', () => {
    it('filters by userId', async () => {
      prisma.recording.findMany.mockResolvedValue([]);
      await service.list('u1');
      expect(prisma.recording.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', status: 'UPLOADED' } }),
      );
    });
  });

  describe('detail', () => {
    it('throws NotFoundException when not found', async () => {
      prisma.recording.findFirst.mockResolvedValue(null);
      await expect(service.detail('u1', 'r1')).rejects.toThrow(NotFoundException);
    });

    it('returns recording with playUrl', async () => {
      prisma.recording.findFirst.mockResolvedValue({ id: 'r1', objectKey: 'recordings/u1/f.webm' });
      const result = await service.detail('u1', 'r1');
      expect(result.playUrl).toBe('http://minio/get');
    });
  });
});
