import { Transform } from 'class-transformer';

export const NormalizePath = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/^\/+|\/+$/g, '')
      : value,
  );
