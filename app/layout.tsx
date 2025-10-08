import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taesk - Kanban Board",
  description: "Trello-like Kanban board with drag and drop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
