import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DiffGuard-AI",
  description: "Evaluation-driven pull request review dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
