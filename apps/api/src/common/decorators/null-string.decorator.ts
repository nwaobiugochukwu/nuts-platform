import { Transform } from 'class-transformer';

export const NullString = () =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value.trim().toLowerCase() === 'null' ? null : value;
  });
