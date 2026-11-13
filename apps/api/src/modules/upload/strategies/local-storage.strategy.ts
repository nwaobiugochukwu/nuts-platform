import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'path';
import {
  FileUploadOptions,
  StorageStrategy,
  UploadableFile,
  UploadedFile,
} from '../upload.interface';

@Injectable()
export class LocalStorageStrategy extends StorageStrategy {
  private readonly uploadPath: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.uploadPath = path.resolve(process.cwd(), 'uploads');
    this.baseUrl = this.config.getOrThrow<string>('BASE_URL');
  }

  async upload(
    file: UploadableFile,
    options?: FileUploadOptions,
  ): Promise<UploadedFile> {
    const folder = options?.folder || 'general';
    const folderParts = folder.split(/[\\/]/);
    if (folderParts.some((part) => !/^[a-zA-Z0-9_-]{1,64}$/.test(part))) {
      throw new BadRequestException('Invalid upload folder');
    }
    const extension = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      throw new BadRequestException('Unsupported upload file extension');
    }
    const safeFolder = folderParts.join(path.sep);
    const fileName = `${randomUUID()}${extension}`;
    const targetDir = path.resolve(this.uploadPath, safeFolder);
    const targetPath = path.resolve(targetDir, fileName);
    this.assertInsideUploadRoot(targetPath);

    try {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetPath, file.buffer);

      return {
        url: `${this.baseUrl}/${folder}/${fileName}`,
        key: `${folder}/${fileName}`,
        mimeType: file.mimetype,
        size: file.size,
      };
    } catch {
      throw new InternalServerErrorException('Failed to upload file locally');
    }
  }

  async delete(key: string): Promise<void> {
    const targetPath = path.resolve(this.uploadPath, key);
    this.assertInsideUploadRoot(targetPath);
    try {
      await fs.unlink(targetPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  private assertInsideUploadRoot(targetPath: string): void {
    const relative = path.relative(this.uploadPath, targetPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Invalid upload path');
    }
  }
}
