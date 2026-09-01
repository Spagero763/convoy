import type { Metadata, Viewport } from "next";
import { WalletProvider } from "../lib/wallet";
import { AppHeader } from "../components/AppHeader";
import { AppFooter } from "../components/AppFooter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convoy",
  description:
    "Fixed-lot batch execution on Starknet. Orders cross together at one rate, so amount and timing stop identifying you.",
  openGraph: {
    title: "Convoy",
    description:
      "Fixed-lot batch execution on Starknet. Orders cross together at one rate.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <AppHeader />
          <main>{children}</main>
          <AppFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
