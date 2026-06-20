import { Fraunces, Archivo, JetBrains_Mono } from "next/font/google";

// Shared so both the layout and portaled shadcn Dialogs can carry the codex fonts.
export const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600", "700"],
});
export const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  weight: ["400", "500", "600"],
});
export const jbmono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  weight: ["400", "500"],
});

export const codexFontVars = `${fraunces.variable} ${archivo.variable} ${jbmono.variable}`;
