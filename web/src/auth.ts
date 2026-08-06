import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const API_URL = process.env.API_URL ?? "http://localhost:3001/v1";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds) => {
        const res = await fetch(`${API_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: creds?.email,
            password: creds?.password,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          organizationId: data.user.organizationId,
          orgRole: data.user.orgRole ?? null,
          accessToken: data.token,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        // values from authorize()
        token.uid = (user as { id: string }).id;
        token.accessToken = (user as { accessToken: string }).accessToken;
        token.role = (user as { role: string }).role as "ADMIN" | "CLIENT";
        token.organizationId = (
          user as { organizationId: string | null }
        ).organizationId;
        token.orgRole = (
          user as { orgRole: "OWNER" | "ADMIN" | "MEMBER" | "OPERATOR" | null }
        ).orgRole;
      }
      // Org switch / invite accept: the client passes the reissued backend
      // JWT and new active-org fields through session.update().
      if (trigger === "update" && session) {
        const update = session as {
          accessToken?: string;
          organizationId?: string | null;
          orgRole?: "OWNER" | "ADMIN" | "MEMBER" | "OPERATOR" | null;
        };
        if (update.accessToken) token.accessToken = update.accessToken;
        if (update.organizationId !== undefined)
          token.organizationId = update.organizationId;
        if (update.orgRole !== undefined) token.orgRole = update.orgRole;
      }
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string;
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as "ADMIN" | "CLIENT";
        session.user.organizationId = token.organizationId as string | null;
        session.user.orgRole =
          (token.orgRole as "OWNER" | "ADMIN" | "MEMBER" | "OPERATOR" | null) ?? null;
      }
      return session;
    },
  },
});
