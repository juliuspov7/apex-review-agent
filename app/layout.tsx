import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apex Review Agent",
  description: "Guest reviews to work orders",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
