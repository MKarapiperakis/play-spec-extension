import * as http from 'http';
import * as https from 'https';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB guard against runaway/hostile responses

export class FetchError extends Error {}

/** Fetches a URL's body as text, following a small number of redirects. GET only, http/https only. */
export function fetchText(url: string, redirectsLeft = MAX_REDIRECTS): Promise<string> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new FetchError(`"${url}" is not a valid URL.`));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new FetchError(`Only http:// and https:// URLs are supported (got "${parsed.protocol}").`));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(
      parsed,
      { headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*' } },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new FetchError('Too many redirects while fetching the spec URL.'));
            return;
          }
          const nextUrl = new URL(res.headers.location, parsed).toString();
          fetchText(nextUrl, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new FetchError(`Request to ${url} failed with HTTP status ${status}.`));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            reject(new FetchError('Response exceeded the 10 MB size limit for a spec file.'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', (err) => reject(new FetchError(err.message)));
      }
    );
    req.on('error', (err) => reject(new FetchError(err.message)));
    req.setTimeout(20000, () => {
      req.destroy(new FetchError(`Timed out fetching ${url}.`));
    });
  });
}
