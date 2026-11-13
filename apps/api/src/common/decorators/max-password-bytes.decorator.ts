import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Bcrypt only considers 72 UTF-8 bytes; reject longer inputs so distinct
 * passwords cannot authenticate as the same truncated byte sequence.
 */
export function MaxPasswordBytes(
  maxBytes = 72,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'maxPasswordBytes',
      target: target.constructor,
      propertyName: String(propertyName),
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown, args) {
          const [limit] = args?.constraints as [number];
          return (
            typeof value === 'string' &&
            Buffer.byteLength(value, 'utf8') <= limit
          );
        },
        defaultMessage(args) {
          const [limit] = args?.constraints as [number];
          return `Password must not exceed ${limit} UTF-8 bytes`;
        },
      },
    });
  };
}
