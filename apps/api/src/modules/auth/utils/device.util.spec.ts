import { describeDevice } from './device.util';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  chromeWindowsNewer:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  firefoxLinux:
    'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
};

describe('describeDevice', () => {
  it.each([
    [UA.chromeWindows, 'Chrome on Windows'],
    [UA.edge, 'Edge on Windows'],
    [UA.firefoxLinux, 'Firefox on Linux'],
    [UA.safariMac, 'Safari on macOS'],
    [UA.safariIphone, 'Safari on iOS'],
    [UA.chromeAndroid, 'Chrome on Android'],
  ])('reads %#: %s', (ua, label) => {
    expect(describeDevice(ua).label).toBe(label);
  });

  it('treats a browser update as the same device', () => {
    expect(describeDevice(UA.chromeWindowsNewer).hash).toBe(
      describeDevice(UA.chromeWindows).hash,
    );
  });

  it('treats a different browser or a different system as a different device', () => {
    const hashes = new Set(
      [
        UA.chromeWindows,
        UA.edge,
        UA.firefoxLinux,
        UA.safariMac,
        UA.safariIphone,
        UA.chromeAndroid,
      ].map((ua) => describeDevice(ua).hash),
    );
    expect(hashes.size).toBe(6);
  });

  it.each([undefined, '', 'curl/8.0', 'Postman'])(
    'treats an unrecognised agent (%p) as one stable unknown device',
    (ua) => {
      const device = describeDevice(ua);
      expect(device.label).toMatch(/Unknown device/);
      expect(device.hash).toBe(describeDevice(undefined).hash);
    },
  );
});
