import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken: string;
    user: {
      id: string;
      role: "ADMIN" | "CLIENT";
      organizationId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: "ADMIN" | "CLIENT";
    organizationId?: string | null;
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    accessToken?: string;
    role?: "ADMIN" | "CLIENT";
    organizationId?: string | null;
  }
}
