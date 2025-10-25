import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/app/contexts/AuthContext";
import NotificationSoundPlayer from "@/app/components/NotificationSoundPlayer";

const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Taesk - Kanban Board",
  description: "Trello-like Kanban board with drag and drop",
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
    <html lang="ja" className="">
      <body>
        <AuthProvider>
          <NotificationSoundPlayer />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
