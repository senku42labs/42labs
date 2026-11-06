import { timingSafeEqual } from 'node:crypto';

export function isAuthorized(authorizationHeader, apiKey) {
  if (!apiKey || typeof authorizationHeader !== 'string') return false;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const supplied = Buffer.from(match[1].trim());
  const expected = Buffer.from(apiKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
