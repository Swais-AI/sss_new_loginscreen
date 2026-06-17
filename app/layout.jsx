import "./globals.css";

export const metadata = {
  title: "SGS Portal Login",
  description: "SGS Portal sign in screen"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
