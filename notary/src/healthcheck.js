// Docker's HEALTHCHECK: exits 0 when /v1/health answers, 1 otherwise. Written in
// Node so that the image needs neither curl nor wget.
const port = Number(process.env.PORT || 8080);

try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(4000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
