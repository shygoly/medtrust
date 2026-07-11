// compile.js — Combine all slide modules into final PPTX
const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "MedTrust";
pres.title = "医疗AI基础设施平台 — Medical Trusted Data Space";
pres.subject = "融资路演 Pitch Deck";

const theme = {
  primary: "03045e",    // Deep navy — titles, dark backgrounds
  secondary: "0077b6",  // Medium blue — body text, secondary elements
  accent: "00b4d8",     // Bright cyan — highlights, key data
  light: "90e0ef",      // Light cyan — card backgrounds, subtle fills
  bg: "ffffff"          // White — main content background
};

for (let i = 1; i <= 18; i++) {
  const num = String(i).padStart(2, "0");
  const slideModule = require(`./slide-${num}.js`);
  slideModule.createSlide(pres, theme);
}

pres
  .writeFile({ fileName: "./output/医疗可信空间融资PPT.pptx" })
  .then((fileName) => {
    console.log("✅ PPTX generated: " + fileName);
  });
