/**
 * base64url for the share payload.
 *
 * Written out rather than pulled in, because it is twenty lines and the whole
 * point of the share feature is that it needs no infrastructure. `btoa`/`atob`
 * are latin1-only, so the string is UTF-8 encoded first — otherwise `µm` would
 * not survive the trip.
 */

export class ShareEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareEncodingError';
  }
}

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeBase64Url(payload: string): string {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ShareEncodingError('Share payload is not valid base64url');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
