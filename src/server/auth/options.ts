import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { and, eq } from "drizzle-orm";
import { getServerEnv } from "@/config/env";
import { loginSchema } from "@/modules/auth/validation";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { clearAuthRateLimit } from "@/server/auth/rate-limit";
import { recordAuthSecurityEvent } from "@/server/auth/events";
import { trustedClientIp } from "@/server/auth/request-security";
import { getDatabase } from "@/server/db";
import { accounts, sessions, users, verificationTokens } from "@/server/db/schema";

const env = getServerEnv();
const providers: NextAuthOptions["providers"] = [];
let dummyPasswordHash: Promise<string> | undefined;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword("PRIZM.DEV-dummy-password-2026");
  return dummyPasswordHash;
}

if (env.PASSWORD_AUTH_ENABLED) {
  providers.push(CredentialsProvider({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials, request) {
      const parsed = loginSchema.safeParse(credentials);
      if (!parsed.success) return null;

      const clientIp = trustedClientIp(request.headers ?? {});
      const [user] = await getDatabase()
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          passwordHash: users.passwordHash,
          authVersion: users.authVersion,
          emailVerified: users.emailVerified,
          accountStatus: users.accountStatus,
          isPlatformAdmin: users.isPlatformAdmin,
        })
        .from(users)
        .where(eq(users.email, parsed.data.email))
        .limit(1);

      const candidateHash = user?.passwordHash ?? await getDummyPasswordHash();
      const passwordMatches = await verifyPassword(parsed.data.password, candidateHash);
      if (!user?.passwordHash || !passwordMatches) {
        await recordAuthSecurityEvent({ eventType: "login", outcome: "invalid_credentials", userId: user?.id, identifier: parsed.data.email, clientIp });
        return null;
      }
      if (!user.emailVerified || user.accountStatus !== "approved") {
        await recordAuthSecurityEvent({
          eventType: "login",
          outcome: !user.emailVerified ? "email_unverified" : `account_${user.accountStatus}`,
          userId: user.id,
          identifier: parsed.data.email,
          clientIp,
        });
        return null;
      }
      await clearAuthRateLimit("login", parsed.data.email);
      await recordAuthSecurityEvent({ eventType: "login", outcome: "success", userId: user.id, identifier: parsed.data.email, clientIp });
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        authVersion: user.authVersion,
        accountStatus: user.accountStatus,
        isPlatformAdmin: user.isPlatformAdmin,
      };
    },
  }));
}

if (env.OAUTH_LOGIN_ENABLED && env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) {
  providers.push(GitHubProvider({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET }));
}

if (env.OAUTH_LOGIN_ENABLED && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
  providers.push(GoogleProvider({
    clientId: env.AUTH_GOOGLE_ID,
    clientSecret: env.AUTH_GOOGLE_SECRET,
    authorization: { params: { prompt: "select_account" } },
  }));
}

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(getDatabase(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers,
  secret: env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  jwt: { maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.id || !account) return false;
      const current = account.type === "oauth"
        ? (await getDatabase()
            .select({ accountStatus: users.accountStatus })
            .from(accounts)
            .innerJoin(users, eq(users.id, accounts.userId))
            .where(and(eq(accounts.provider, account.provider), eq(accounts.providerAccountId, account.providerAccountId)))
            .limit(1))[0]
        : (await getDatabase()
            .select({ accountStatus: users.accountStatus })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1))[0];
      return current?.accountStatus === "approved";
    },
    async jwt({ token, user }) {
      if (user?.id) {
        const [current] = await getDatabase()
          .select({ authVersion: users.authVersion, accountStatus: users.accountStatus, isPlatformAdmin: users.isPlatformAdmin })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        if (!current || current.accountStatus !== "approved") {
          delete token.sub;
          token.invalidated = true;
          return token;
        }
        token.sub = user.id;
        token.authVersion = current.authVersion;
        token.accountStatus = current.accountStatus;
        token.isPlatformAdmin = current.isPlatformAdmin;
        token.invalidated = false;
        return token;
      }
      if (token.sub) {
        const [current] = await getDatabase()
          .select({ authVersion: users.authVersion, accountStatus: users.accountStatus, isPlatformAdmin: users.isPlatformAdmin })
          .from(users)
          .where(eq(users.id, token.sub))
          .limit(1);
        if (!current || current.authVersion !== token.authVersion || current.accountStatus !== "approved") {
          delete token.sub;
          token.invalidated = true;
        } else {
          token.accountStatus = current.accountStatus;
          token.isPlatformAdmin = current.isPlatformAdmin;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub && !token.invalidated ? token.sub : "";
        session.user.accountStatus = token.accountStatus ?? "pending";
        session.user.isPlatformAdmin = Boolean(token.isPlatformAdmin);
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!account || account.provider === "credentials") return;
      await recordAuthSecurityEvent({
        eventType: "oauth_login",
        outcome: "success",
        userId: user.id,
        identifier: user.email,
        metadata: { provider: account.provider },
      });
    },
  },
};
