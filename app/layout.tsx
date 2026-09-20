import "./globals.css";
import "./zen-backgrounds.css";
import "./unresolved-items.css";

export const metadata = {
  title: "Korben OS",
  description: "Multi-agent operating system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
