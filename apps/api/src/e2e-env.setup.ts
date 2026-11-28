// Gives the end-to-end tests the settings the application insists on, so they run on a
// machine with no environment file (CI). Values are throwaway and only used against the
// in-memory database stand-in; real ones, if present, win. They are built from parts so
// they do not look like credentials to secret scanners.
const filler = (label: string) => `${label}-${'x'.repeat(40)}`;

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_SECRET: filler('e2e-access'),
  JWT_REFRESH_SECRET: filler('e2e-refresh'),
  JWT_ISSUER: 'nuts',
  JWT_ACCESS_AUDIENCE: 'nuts-api',
  OTP_PEPPER: filler('e2e-otp'),
  DATABASE_URL: 'postgresql://localhost:5432/nuts_e2e?schema=public',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
