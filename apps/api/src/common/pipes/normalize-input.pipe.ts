import { Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class NormalizeInputPipe implements PipeTransform {
  private readonly exactValueKeys = new Set([
    'password',
    'currentpassword',
    'newpassword',
    'confirmpassword',
    'refreshtoken',
    'accesstoken',
    'token',
    'authorization',
    'otp',
    'code',
    'signature',
  ]);

  transform(value: unknown): unknown {
    return this.normalize(value);
  }

  private normalize(value: unknown, preserveExactValue = false): unknown {
    // Multer uploads use Buffer instances. Recursing into a Buffer corrupts
    // it into a plain object before the storage service can consume it.
    if (Buffer.isBuffer(value)) return value;

    if (typeof value === 'string') {
      return preserveExactValue ? value : value.trim();
    }

    if (Array.isArray(value)) {
      return value.map((v: unknown) => this.normalize(v, preserveExactValue));
    }

    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};

      for (const key of Object.keys(record)) {
        result[key] = this.normalize(
          record[key],
          preserveExactValue || this.exactValueKeys.has(key.toLowerCase()),
        );
      }

      return result;
    }

    return value;
  }
}
