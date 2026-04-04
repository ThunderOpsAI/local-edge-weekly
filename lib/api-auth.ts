import { NextResponse } from "next/server";

export function buildApiLoginRedirect(request: Request) {
  const requestUrl = new URL(request.url);
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("next", requestUrl.pathname);
  return NextResponse.redirect(loginUrl);
}
