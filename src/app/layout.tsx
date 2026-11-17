import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HOAX1G.DEV STUDIOS", template: "%s · HOAX1G.DEV STUDIOS" },
  description: "Evidence-led prospect intelligence for developers and digital agencies.",
  applicationName: "HOAX1G.DEV STUDIOS",
  authors: [{ name: "HOAX1G.DEV" }],
  creator: "HOAX1G.DEV",
  icons: { icon: [{ url: "/branding/hoax1g-studios-emblem.png", type: "image/png" }] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
