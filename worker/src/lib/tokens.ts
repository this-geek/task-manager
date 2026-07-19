const TOKEN_PREFIX = 'tm_live_';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateToken(): { plaintext: string; prefix: string } {
  const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const plaintext = `${TOKEN_PREFIX}${secret}`;
  return { plaintext, prefix: plaintext.slice(0, 8) };
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(digest);
}
