import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Pages that only make sense without a session: a signed-in visitor is sent
// to their home instead of seeing the form. /forgot-password and
// /reset-password stay reachable on purpose: the reset link from the email
// is the only way to change a password, session or not.
const AUTH_PAGES = ["/signin", "/signup"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;
  const isAdmin = req.auth?.user?.role === "ADMIN";

  if (AUTH_PAGES.includes(pathname) && isAuthed) {
    // Honour the callbackUrl this middleware sets when it bounces an
    // anonymous visitor to /signin, but only when it resolves to this same
    // origin: "//host", "/\\host" and absolute URLs would otherwise turn the
    // redirect into an open redirect.
    const callback = req.nextUrl.searchParams.get("callbackUrl");
    let safeCallback: string | null = null;
    if (callback) {
      const target = new URL(callback, req.nextUrl.origin);
      if (target.origin === req.nextUrl.origin && !AUTH_PAGES.includes(target.pathname)) {
        safeCallback = target.pathname + target.search;
      }
    }
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
  ],
};
