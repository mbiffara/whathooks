import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Pages that only make sense without a session: a signed-in visitor is sent
// to their home instead of seeing the form.
const AUTH_PAGES = ["/signin", "/signup", "/forgot-password", "/reset-password"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;
  const isAdmin = req.auth?.user?.role === "ADMIN";

  const isAuthPage = AUTH_PAGES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isAuthPage && isAuthed) {
    // Honour a relative callbackUrl (the one this middleware sets when it
    // bounces an anonymous visitor to /signin); anything absolute is dropped
    // so the redirect can't leave the site.
    const callback = req.nextUrl.searchParams.get("callbackUrl");
    const safeCallback =
      callback && callback.startsWith("/") && !callback.startsWith("//")
        ? callback
        : null;
    const home = isAdmin ? "/admin" : "/dashboard";
    return NextResponse.redirect(new URL(safeCallback ?? home, req.nextUrl.origin));
  }

  const needsAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/onboarding");

  if (needsAuth && !isAuthed) {
    const url = new URL("/signin", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  // /onboarding needs auth but no particular role: any signed-in user can
  // open it to try the flow. Nothing routes them there yet — no nav entry
  // and no redirect after signup.
  if (pathname.startsWith("/admin") && !isAdmin) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/onboarding/:path*",
    "/signin",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ],
};
