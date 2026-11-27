import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiErrorResponse } from 'cloudinary';

export interface ImageUploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export interface ImageOptions {
  width?: number;
  height?: number;
  quality?: string;
  format?: string;
  crop?: string;
}

/**
 * Files arriving from multer memory storage carry a `buffer` — not a `path`.
 * The `path` property is only set when multer uses disk storage.
 */
export interface CloudinaryFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
  /** Legacy disk-storage path — undefined when using memory storage */
  path?: string;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly isConfigured: boolean;
  private readonly folder: string;

  constructor(private readonly configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    this.folder =
      this.configService.get<string>('CLOUDINARY_FOLDER') ?? 'products';

    this.isConfigured = !!(cloudName && apiKey && apiSecret);

    if (this.isConfigured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.logger.log('Cloudinary configured successfully');
    } else {
      this.logger.warn('Cloudinary not configured — image uploads disabled');
    }
  }

  /**
   * Upload an image buffer to Cloudinary via upload_stream.
   *
   * Why upload_stream instead of uploader.upload(path)?
   *   Multer is configured with memory storage — files live in file.buffer,
   *   not on disk. uploader.upload() expects a local filesystem path or a
   *   remote URL. Passing undefined (missing path) causes a silent 500 from
   *   Cloudinary. upload_stream accepts a raw Buffer directly.
   */
  async uploadImage(
    file: CloudinaryFile,
    folder: string = this.folder,
  ): Promise<ImageUploadResult> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Image upload is not configured on this server',
      );
    }

    if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException('Invalid or empty image file');
    }

    return new Promise<ImageUploadResult>((resolve, reject) => {
      const isSvg = file.mimetype === 'image/svg+xml';
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          ...(isSvg
            ? { resource_type: 'image' as const }
            : {
                transformation: [
                  { width: 1200, height: 1200, crop: 'limit', quality: 'auto' },
                  { fetch_format: 'auto' },
                ],
              }),
        },
        (error: UploadApiErrorResponse | undefined, result) => {
          if (error || !result) {
            const message = error?.message ?? 'Cloudinary upload failed';
            const httpStatus = error?.http_code;

            this.logger.error(
              `Cloudinary upload error [${httpStatus ?? 'unknown'}]: ${message}`,
            );

            // Surface meaningful errors instead of a raw 500
            if (httpStatus === 400) {
              reject(new BadRequestException(`Upload rejected: ${message}`));
            } else if (httpStatus === 401) {
              reject(
                new ServiceUnavailableException(
                  'Cloudinary credentials are invalid — check CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET',
                ),
              );
            } else {
              reject(
                new BadGatewayException(`Image upload failed: ${message}`),
              );
            }
            return;
          }

          const rawUrl = result.secure_url;
          const optimizedUrl =
            isSvg || !rawUrl.includes('/upload/')
              ? rawUrl
              : rawUrl.includes('/upload/f_auto,q_auto/')
                ? rawUrl
                : rawUrl.replace('/upload/', '/upload/f_auto,q_auto/');

          resolve({
            url: optimizedUrl,
            publicId: result.public_id,
            width: result.width ?? 0,
            height: result.height ?? 0,
            format: result.format ?? 'jpg',
            bytes: result.bytes ?? 0,
          });
        },
      );

      try {
        uploadStream.end(file.buffer);
      } catch (error) {
        this.logger.error('Unable to write image data to Cloudinary', error);
        reject(new BadRequestException('Invalid image upload data'));
      }
    });
  }

  /**
   * Get optimized image URL with transformations
   */
  getOptimizedUrl(publicId: string, options: ImageOptions = {}): string {
    if (!this.isConfigured) return publicId;

    const {
      width = 800,
      height = 800,
      quality = 'auto',
      format = 'auto',
      crop = 'fill',
    } = options;

    return cloudinary.url(publicId, {
      transformation: [
        { width, height, crop, quality },
        { fetch_format: format },
      ],
    });
  }

  /**
   * Delete an image from Cloudinary
   */
  async deleteImage(publicId: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn('Cloudinary not configured — skipping image deletion');
      return;
    }

    try {
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(`Image deleted successfully: ${publicId}`);
    } catch (error) {
      this.logger.error('Failed to delete image from Cloudinary', error);
      throw new BadGatewayException('Image deletion service is unavailable');
    }
  }

  /**
   * Get multiple responsive image URLs for different screen sizes
   */
  getResponsiveUrls(publicId: string): {
    mobile: string;
    tablet: string;
    desktop: string;
  } {
    return {
      mobile: this.getOptimizedUrl(publicId, { width: 400, height: 400 }),
      tablet: this.getOptimizedUrl(publicId, { width: 800, height: 800 }),
      desktop: this.getOptimizedUrl(publicId, { width: 1200, height: 1200 }),
    };
  }

  /**
   * Extract public ID from a Cloudinary URL
   */
  extractPublicId(url: string): string {
    if (!this.isConfigured) return url;

    try {
      const urlParts = url.split('/');
      const filename = urlParts[urlParts.length - 1];
      const publicId = filename.split('.')[0];
      const folder = urlParts[urlParts.length - 2];
      return `${folder}/${publicId}`;
    } catch (error) {
      this.logger.error('Failed to extract public ID from URL', error);
      return url;
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }
}
