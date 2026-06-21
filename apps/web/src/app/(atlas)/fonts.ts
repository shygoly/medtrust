import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

// Match the /space console: IBM Plex Sans/Mono. Shared so portaled shadcn
// Dialog/Select can carry the same fonts.
export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
});
export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
});

export const codexFontVars = `${plexSans.variable} ${plexMono.variable}`;
