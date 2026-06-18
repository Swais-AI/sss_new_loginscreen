import "./globals.css";

export const metadata = {
  title: "SSS Portal Login",
  description: "SSS Portal sign in screen"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
