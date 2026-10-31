/**
 * Minimal `multipart/form-data` reader for MSW handlers.
 *
 * Why not `request.formData()`: undici re-parses the body and validates each
 * part against undici's own `File`, but in jsdom the global `File` is jsdom's
 * class, so the parse throws
 * `AssertionError: webidl.is.USVString(value) || webidl.is.File(value)`.
 * Swapping the globals is not a fix either — jsdom's `FormData` only recognises
 * its own `Blob`, so a native `File` gets serialised as the string
 * `"[object File]"` and the payload is lost. This parser reads the bytes the
 * writer actually produced, so the mock neither depends on which class the test
 * environment exposes nor perturbs the globals for the rest of the suite.
 *
 * The backend contract only needs the field name, filename, mime type and byte
 * length of each part, which is everything returned here.
 */

export interface MultipartPart {
  /** Form field name, e.g. `file`. */
  name: string;
  /** Present only for file inputs. */
  filename: string | null;
  mime: string;
  /** Exact payload length in bytes. */
  size: number;
}

const BOUNDARY = /boundary=(?:"([^"]+)"|([^;\s]+))/i;

/** Every part of a multipart body, or `[]` when the body is not multipart. */
export async function multipartParts(request: Request): Promise<MultipartPart[]> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data/i.test(contentType)) return [];

  const match = BOUNDARY.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return [];

  // `latin1` maps one character per byte, so string offsets are byte offsets and
  // each payload's length is exact — no counting of utf-8 continuation bytes.
  const raw = Buffer.from(await request.arrayBuffer()).toString('latin1');
  const parts: MultipartPart[] = [];

  // Splitting on the delimiter leaves each chunk as `\r\n<headers>\r\n\r\n<body>`.
  // The preamble (before the first delimiter) and the closing `--` chunk have no
  // header separator and are skipped.
  for (const chunk of raw.split(`--${boundary}`)) {
    const headersEnd = chunk.indexOf('\r\n\r\n');
    if (headersEnd < 0) continue;

    const headers = chunk.slice(0, headersEnd);
    const disposition = /(?:^|\r\n)content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1];
    if (!name) continue;

    // The CRLF before the next delimiter terminates the delimiter line, not the
    // payload, so it must not be counted in `size`.
    const body = chunk.slice(headersEnd + 4).replace(/\r\n$/, '');

    parts.push({
      name,
      filename: /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null,
      mime:
        /(?:^|\r\n)content-type:([^\r\n]+)/i.exec(headers)?.[1]?.trim() ??
        'application/octet-stream',
      size: body.length,
    });
  }

  return parts;
}

/** The first part named `file`, which is what `POST /media` declares. */
export async function uploadedFile(request: Request): Promise<MultipartPart | null> {
  const parts = await multipartParts(request);
  return parts.find((part) => part.name === 'file') ?? null;
}
