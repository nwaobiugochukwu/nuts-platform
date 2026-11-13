import { Transform } from 'class-transformer';

export const ToNumberDefault = (defaultValue: number) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return defaultValue;

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  });
