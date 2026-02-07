import type { Metadata } from "next";
import "highlight.js/styles/github-dark.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Code Web UI",
  description: "Claude Code CLI 웹 인터페이스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
