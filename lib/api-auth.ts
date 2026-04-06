import { NextResponse } from "next/server";
import { buildPublicUrl } from "@/lib/request-url";

export function buildApiLoginRedirect(request: Request) {
  const requestUrl = new URL(request.url);
  const loginUrl = buildPublicUrl(request, "/login");
  loginUrl.searchParams.set("next", requestUrl.pathname);
  return NextResponse.json(
    {
      error: "Login required",
      loginUrl: loginUrl.toString(),
    },
    { status: 401 },
  );
}
