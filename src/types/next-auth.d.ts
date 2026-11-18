import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    authVersion?: number;
    accountStatus?: "pending" | "approved" | "rejected" | "suspended";
    isPlatformAdmin?: boolean;
  }

  interface Session {
    user: {
      id: string;
      accountStatus: "pending" | "approved" | "rejected" | "suspended";
      isPlatformAdmin: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authVersion?: number;
    invalidated?: boolean;
    accountStatus?: "pending" | "approved" | "rejected" | "suspended";
    isPlatformAdmin?: boolean;
  }
}
