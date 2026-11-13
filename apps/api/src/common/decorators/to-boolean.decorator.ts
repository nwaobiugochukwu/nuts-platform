import { Transform } from 'class-transformer';

export const ToBoolean = () =>
  Transform(({ value, obj, key }) => {
    const source = obj as unknown;
    const rawValue =
      typeof source === 'object' &&
      source !== null &&
      Object.prototype.hasOwnProperty.call(source, key)
        ? (source as Record<string, unknown>)[key]
        : (value as unknown);

    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue !== 'string') return rawValue;

    const normalized = rawValue.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return rawValue;
  });
