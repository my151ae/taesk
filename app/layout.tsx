import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/app/contexts/AuthContext";
import NotificationSoundPlayer from "@/app/components/NotificationSoundPlayer";
import NotificationBadgeListener from "@/app/components/NotificationBadgeListener";
import PushSubscriptionSync from "@/app/components/PushSubscriptionSync";

const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Taesk - Timeline Board",
  description: "Timeline planning board with A/B task buckets",
  manifest: "/manifest.json",
  metadataBase: new URL(appOrigin),
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Taesk",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0ea5e9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <AuthProvider>
          <NotificationSoundPlayer />
          <NotificationBadgeListener />
          <PushSubscriptionSync />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
