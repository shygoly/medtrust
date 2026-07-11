const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'cover',
  index: 1,
  title: '医疗AI基础设施平台'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.primary };

  // Top accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.06,
    fill: { color: theme.accent }
  });

  // Decorative circles (subtle, top-right)
  slide.addShape(pres.shapes.OVAL, {
    x: 7.5, y: 0.3, w: 2.8, h: 2.8,
    fill: { color: theme.accent, transparency: 88 }
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 8.2, y: 0.8, w: 1.8, h: 1.8,
    fill: { color: theme.secondary, transparency: 80 }
  });

  // Main title (Chinese)
  slide.addText("医疗AI基础设施平台", {
    x: 0.8, y: 1.5, w: 8.4, h: 1.0,
    fontSize: 44, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "left",
    margin: 0
  });

  // Subtitle (English)
  slide.addText("Medical Trusted Data Space", {
    x: 0.8, y: 2.45, w: 8.4, h: 0.6,
    fontSize: 28, fontFace: "Georgia",
    color: theme.accent, bold: false, align: "left",
    margin: 0
  });

  // Accent divider line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.8, y: 3.2, w: 2.0, h: 0.04,
    fill: { color: theme.accent }
  });

  // Positioning statement
  slide.addText("连接医院、AI企业、药企、保险与科研机构\n打造医疗AI时代的数据基础设施", {
    x: 0.8, y: 3.45, w: 7.5, h: 0.7,
    fontSize: 15, fontFace: "Microsoft YaHei",
    color: theme.light, bold: false, align: "left",
    lineSpacingMultiple: 1.3,
    margin: 0
  });

  // Slogan (italic, bottom)
  slide.addText("Data is the New Infrastructure of Medical AI.", {
    x: 0.8, y: 4.6, w: 8.4, h: 0.5,
    fontSize: 14, fontFace: "Georgia",
    color: theme.accent, italic: true, align: "left",
    margin: 0
  });

  // Bottom accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.565, w: 10, h: 0.06,
    fill: { color: theme.accent }
  });

  return slide;
}

if (require.main === module) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  const theme = {
    primary: "03045e",
    secondary: "0077b6",
    accent: "00b4d8",
    light: "90e0ef",
    bg: "ffffff"
  };
  createSlide(pres, theme);
  pres.writeFile({ fileName: "slide-01-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
