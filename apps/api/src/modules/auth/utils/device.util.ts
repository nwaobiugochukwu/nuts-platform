import { createHash } from 'node:crypto';

export interface DeviceDescription {
  /** Stable for one browser on one operating system, for example `Chrome on Windows`. */
  label: string;
  /** What "the same device" means: a hash of the browser and the operating system. */
  hash: string;
}

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  // Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari".
  [/\bEdg(?:e|A|iOS)?\//i, 'Edge'],
  [/\bOPR\/|\bOpera\b/i, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//i, 'Firefox'],
  [/\bChrome\/|\bCriOS\//i, 'Chrome'],
  [/\bSafari\//i, 'Safari'],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\bAndroid\b/i, 'Android'],
  [/\biPhone\b|\biPad\b|\biPod\b/i, 'iOS'],
  [/\bWindows\b/i, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/i, 'macOS'],
  [/\bCrOS\b/i, 'ChromeOS'],
  [/\bLinux\b/i, 'Linux'],
];

const first = (
  table: ReadonlyArray<[RegExp, string]>,
  userAgent: string,
): string | undefined =>
  table.find(([pattern]) => pattern.test(userAgent))?.[1];

/**
 * Describes the browser and system in a User-Agent for a "new sign-in" alert. Deliberately
 * coarse: the version and the IP address are left out, so a browser update or a changing
 * network does not look like a new device. A missing or unrecognised agent is one device
 * ("Unknown device") rather than a new one each time.
 */
export function describeDevice(
  userAgent: string | undefined,
): DeviceDescription {
  const ua = userAgent ?? '';
  const browser = first(BROWSERS, ua);
  const system = first(SYSTEMS, ua);
  const label =
    browser && system
      ? `${browser} on ${system}`
      : (browser ?? (system ? `Browser on ${system}` : 'Unknown device'));
  const hash = createHash('sha256')
    .update(`${browser ?? 'unknown'}|${system ?? 'unknown'}`)
    .digest('hex');
  return { label, hash };
}
