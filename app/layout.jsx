import "./globals.css";

export const metadata = {
  title: "小红书素材台",
  description: "按账号和作品整理小红书图片、文案、复制和下载。"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
