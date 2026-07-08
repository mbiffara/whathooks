import type { DefaultSession } from "next-auth";

type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

declare module "next-auth" {
  interface Session {
    accessToken: string;
    user: {
      id: string;
      role: "ADMIN" | "CLIENT";
      organizationId: string | null;
      orgRole: OrgRole | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: "ADMIN" | "CLIENT";
    organizationId?: string | null;
    orgRole?: OrgRole | null;
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    accessToken?: string;
    role?: "ADMIN" | "CLIENT";
    organizationId?: string | null;
    orgRole?: OrgRole | null;
  }
}
