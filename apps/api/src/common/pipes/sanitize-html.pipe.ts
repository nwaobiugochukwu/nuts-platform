import { Injectable, PipeTransform } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sanitizeHtml = require('sanitize-html') as (
  dirty: string,
  options?: {
    allowedTags?: string[];
    allowedAttributes?: Record<string, string[]>;
  },
) => string;

/**
 * Global pipe that sanitizes all string values in the incoming request body,
 * query parameters, and params using the `sanitize-html` library. It removes
 * potentially dangerous HTML tags and attributes to mitigate XSS attacks.
 *
 * After stripping tags, HTML entities (&amp; &lt; &gt; &quot; &#x27;) are
 * decoded back to their plain-text equivalents so downstream code and slug
 * generation always receives clean, un-escaped strings.
 */
@Injectable()
export class SanitizeHtmlPipe implements PipeTransform {
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
    return this.sanitize(value);
  }

  private sanitize(value: unknown, preserveExactValue = false): unknown {
    // Binary multipart payloads must not be sanitised as object trees.
    if (Buffer.isBuffer(value)) return value;

    if (typeof value === 'string') {
      if (preserveExactValue) return value;
      const stripped: string = sanitizeHtml(value, {
        allowedTags: [], // strip all HTML tags
        allowedAttributes: {},
      });
      // Decode the HTML entities that sanitize-html introduces so that
      // plain text inputs like "Home & Living" are not stored as "Home &amp; Living".
      const decoded = this.decodeEntities(stripped);
      // Keep tag-shaped text encoded. A later unsafe HTML sink must not be able
      // to turn an encoded user string back into executable markup.
      return /<\/?[a-z][^>]*>/i.test(decoded) ? stripped : decoded;
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.sanitize(v, preserveExactValue));
    }

    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        result[key] = this.sanitize(
          record[key],
          preserveExactValue || this.exactValueKeys.has(key.toLowerCase()),
        );
      }
      return result;
    }

    return value;
  }

  /**
   * Decode the five XML/HTML entities that sanitize-html may introduce when
   * stripping tags from a string that contained no actual markup.
   */
  private decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'");
  }
}
