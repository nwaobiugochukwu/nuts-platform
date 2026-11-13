import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { StrictThrottle } from '@api/common/decorators/custom-throttler.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import type { CloudinaryFile } from '@api/infrastructure/cloudinary/cloudinary.service';
import {
  CloudinaryService,
  ImageOptions,
} from '@api/infrastructure/cloudinary/cloudinary.service';

const MAX_IMAGES = 6;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function hasAllowedImageSignature(file: CloudinaryFile): boolean {
  const bytes = file.buffer;
  switch (file.mimetype) {
    case 'image/jpeg':
    case 'image/jpg':
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP'
      );
    default:
      return false;
  }
}

@ApiTags('IMAGES')
@Controller('images')
export class ImageUploadController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  /** The sole upload endpoint: submit one to six `files` multipart fields. */
  @Post('upload')
  @Roles(ROLE.ADMIN, ROLE.VENDOR)
  @StrictThrottle()
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES, {
      limits: {
        fileSize: MAX_IMAGE_SIZE,
        files: MAX_IMAGES,
        fields: 0,
        parts: MAX_IMAGES,
      },
      fileFilter: (_request, file, callback) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(
              'Only JPEG, PNG, and WebP images are allowed',
            ),
            false,
          );
        }
      },
    }),
  )
  @ApiOperation({ summary: 'Upload one or multiple images' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  async uploadImages(@UploadedFiles() files: CloudinaryFile[]) {
    if (!files?.length)
      throw new BadRequestException('Provide at least one image');
    if (files.length > MAX_IMAGES) {
      throw new BadRequestException(
        `A maximum of ${MAX_IMAGES} images is allowed`,
      );
    }

    for (const file of files) {
      if (
        !ALLOWED_MIME_TYPES.has(file.mimetype) ||
        !hasAllowedImageSignature(file)
      ) {
        throw new BadRequestException(
          'Only valid JPEG, PNG, and WebP images are allowed',
        );
      }
      if (file.size > MAX_IMAGE_SIZE) {
        throw new BadRequestException('Each image must be 5 MB or smaller');
      }
      if (!Buffer.isBuffer(file.buffer)) {
        throw new BadRequestException('Invalid image upload data');
      }
    }

    return Promise.all(
      files.map((file) => this.cloudinaryService.uploadImage(file)),
    );
  }

  @Get('optimized')
  @ApiQuery({ name: 'publicId', required: true })
  @ApiQuery({ name: 'width', required: false })
  @ApiQuery({ name: 'height', required: false })
  getOptimizedUrl(@Query() query: ImageOptions & { publicId: string }) {
    const { publicId, ...options } = query;
    this.assertPublicId(publicId);
    for (const dimension of [options.width, options.height]) {
      if (
        dimension !== undefined &&
        (!Number.isInteger(Number(dimension)) ||
          Number(dimension) < 1 ||
          Number(dimension) > 2000)
      ) {
        throw new BadRequestException(
          'Image dimensions must be between 1 and 2000 pixels',
        );
      }
    }
    if (
      options.crop &&
      !['fill', 'fit', 'limit', 'scale', 'pad', 'crop'].includes(options.crop)
    ) {
      throw new BadRequestException('Unsupported image crop mode');
    }
    if (
      options.format &&
      !['auto', 'jpg', 'png', 'webp', 'avif'].includes(options.format)
    ) {
      throw new BadRequestException('Unsupported image format');
    }
    if (
      options.quality &&
      !['auto', 'auto:good', 'auto:best', 'auto:eco', 'auto:low'].includes(
        options.quality,
      )
    ) {
      throw new BadRequestException('Unsupported image quality');
    }
    return { url: this.cloudinaryService.getOptimizedUrl(publicId, options) };
  }

  @Get('responsive')
  @ApiQuery({ name: 'publicId', required: true })
  getResponsiveUrls(@Query('publicId') publicId: string) {
    this.assertPublicId(publicId);
    return this.cloudinaryService.getResponsiveUrls(publicId);
  }

  private assertPublicId(publicId: string): void {
    if (
      typeof publicId !== 'string' ||
      publicId.length > 255 ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(publicId)
    ) {
      throw new BadRequestException('Invalid image identifier');
    }
  }
}

export const UploadController = ImageUploadController;
