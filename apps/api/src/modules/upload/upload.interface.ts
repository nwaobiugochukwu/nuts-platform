export interface FileUploadOptions {
  folder?: string;
  fileName?: string;
}

export interface UploadedFile {
  url: string;
  key: string;
  mimeType: string;
  size: number;
}

export interface UploadableFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export abstract class StorageStrategy {
  abstract upload(
    file: UploadableFile,
    options?: FileUploadOptions,
  ): Promise<UploadedFile>;
  abstract delete(key: string): Promise<void>;
}
