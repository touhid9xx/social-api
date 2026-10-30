export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json({
    status: 'ok',
    service: 'social-frontend',
    version: '0.1.0',
    upstream: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost',
  });
}
