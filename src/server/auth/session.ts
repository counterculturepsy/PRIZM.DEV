import { and, asc, eq } from "drizzle-orm";
import { getServerSession, type Session } from "next-auth";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/server/db";
import { users, workspaceMembers, workspaces } from "@/server/db/schema";
import { authOptions } from "./options";

async function getDevelopmentSession(): Promise<Session | null> {
  if (!getServerEnv().DEV_AUTH_BYPASS) return null;

  const [member] = await getDatabase()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.status, "active")),
    )
    .innerJoin(
      workspaces,
      and(eq(workspaces.id, workspaceMembers.workspaceId), eq(workspaces.status, "active")),
    )
    .orderBy(asc(users.createdAt))
    .limit(1);

  if (!member) return null;

  return {
    user: member,
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export async function requireSession() {
  const developmentSession = await getDevelopmentSession();
  if (developmentSession) return developmentSession;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  return session;
}
