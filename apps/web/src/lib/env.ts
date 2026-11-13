const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

if (!backendUrl) {
  throw new Error(
    "[ENV] NEXT_PUBLIC_BACKEND_URL is required.\n" +
      "Set it in your .env file: NEXT_PUBLIC_BACKEND_URL=http://localhost:3001"
  );
}

export const env = {
  backendUrl: backendUrl.replace(/\/api\/v1\/?$|\/$/, "") + "/api/v1",
} as const;
