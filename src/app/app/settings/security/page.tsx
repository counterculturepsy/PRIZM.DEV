import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/server/auth/session";
import { getDatabase } from "@/server/db";
import { users } from "@/server/db/schema";
import { PasswordSetupForm } from "./password-setup-form";

export const metadata: Metadata = { title: "Account security" };

export default async function SecuritySettingsPage() {
  const session = await requireSession();
  const [user] = await getDatabase().select({ hasPassword: users.passwordHash, emailVerified: users.emailVerified }).from(users).where(eq(users.id, session.user.id)).limit(1);
  return <section><h2 className="text-xl font-semibold">Account security</h2><p className="mt-2 text-sm text-muted-foreground">Manage independent password access before external sign-in providers are disabled.</p><Card className="mt-6 max-w-2xl p-6"><h3 className="font-semibold">Email and password login</h3>{user?.hasPassword ? <p className="mt-3 text-sm text-success">Password login is established{user.emailVerified ? " and the account email is verified" : ""}.</p> : <><p className="mt-3 text-sm text-muted-foreground">Create a password while this authenticated session is active. Your platform approval state is unchanged.</p><PasswordSetupForm /></>}</Card></section>;
}
