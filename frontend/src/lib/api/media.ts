import { apiBaseUrl } from '@/lib/env';
import type { components } from '@/types/api';

import { apiClient, apiRequest } from './client';

/**
 * `POST /api/v1/media` and `POST /api/v1/media/{media_id}/attach/{post_id}`.
 *
 * Media is a **two-step** flow on this backend, not a field on `PostCreate`:
 * upload the bytes first (deduplicated per owner by SHA-256), then attach the
 * returned id to a post. `PostCreate` is `extra="forbid"` and accepts only
 * `body` + `visibility`, so a post and its media cannot be created in one
 * request — the composer uploads after the post exists.
 *
 * Both calls go through `apiClient`, so they inherit the bearer token and the
 * single-flight 401 refresh. Attaching is NOT idempotent and not retried: the
 * backend rejects a second attach of the same row, and a blind retry would
 * turn a transport blip into a `MEDIA_ALREADY_ATTACHED` error.
 */

export type MediaView = components['schemas']['MediaView'];

/** Mirrors `MEDIA_MAX_*_BYTES` (`.env.example:81`) so the browser can refuse
 *  an obviously oversized file before spending the upload. The backend
 *  re-validates by magic bytes; this is UX, not security. */
export const MEDIA_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/**
 * Resolve a backend-provided media URL for use in `src`.
 *
 * `LocalStorage.url_for` returns a **root-relative** path (`/static/media/…`),
 * which in the browser would resolve against the Next.js origin. The API can
 * live on another origin (`NEXT_PUBLIC_API_URL`), so the path is prefixed once,
 * here, rather than in every render site. Absolute URLs (a future S3/CDN
 * backend) pass through untouched.
 */
export function mediaUrl(url: string): string {
  return url.startsWith('/') ? `${apiBaseUrl}${url}` : url;
}

export async function uploadMedia(file: File): Promise<MediaView> {
  const body = new FormData();
  // The third argument makes the filename explicit. Per the fetch spec the
  // filename is only inferred from the value when the runtime recognises it as a
  // `File`; a `Blob` (or a non-native `File`, as in jsdom) would otherwise
  // upload as `blob`, so the server could never see the user's original name.
  body.append('file', file, file.name);

  return apiRequest(() =>
    apiClient.POST('/api/v1/media', {
      // openapi-fetch detects `FormData` at runtime and lets the browser set the
      // multipart boundary; the generated type only models the part names.
      body: body as unknown as components['schemas']['Body_upload_media_api_v1_media_post'],
    }),
  );
}

export async function attachMediaToPost(mediaId: number, postId: number): Promise<MediaView> {
  return apiRequest(() =>
    apiClient.POST('/api/v1/media/{media_id}/attach/{post_id}', {
      params: { path: { media_id: mediaId, post_id: postId } },
    }),
  );
}
