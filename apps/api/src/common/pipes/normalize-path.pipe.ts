import { Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class NormalizePathPipe implements PipeTransform {
  transform(value: string) {
    if (!value) return value;

    // Normalize path: split by '/' or ',' to support both separators, remove empty parts, and join with '/'
    return value
      .split(/[/,]/) // split by slash or comma
      .filter(Boolean) // remove empty values
      .join('/'); // always join with slash
  }
}
