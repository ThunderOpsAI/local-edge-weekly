function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function getPublicBaseUrl(request: Request) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));

  if (forwardedHost) {
    const protocol = forwardedProto || "https";
    return `${protocol}://${forwardedHost}`;
  }

  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL;
  }

  return new URL(request.url).origin;
}

export function buildPublicUrl(request: Request, path: string) {
  return new URL(path, getPublicBaseUrl(request));
}
