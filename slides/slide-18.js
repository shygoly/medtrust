const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'summary',
  index: 18,
  title: 'Build the Infrastructure of Medical AI'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.primary };

  // Top accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 0.06,
    fill: { color: theme.accent }
  });

  // Decorative circles (subtle)
  slide.addShape(pres.shapes.OVAL, {
    x: 7.0, y: 0.5, w: 3.5, h: 3.5,
    fill: { color: theme.accent, transparency: 90 }
  });
  slide.addShape(pres.shapes.OVAL, {
    x: 0.5, y: 3.0, w: 2.5, h: 2.5,
    fill: { color: theme.secondary, transparency: 88 }
  });

  // Main title
  slide.addText("Build the Infrastructure\nof Medical AI", {
    x: 0.8, y: 1.3, w: 8.4, h: 1.2,
    fontSize: 38, fontFace: "Georgia",
    color: "FFFFFF", bold: true, align: "center", valign: "middle",
    lineSpacingMultiple: 1.1, margin: 0
  });

  // Chinese subtitle
  slide.addText("建设医疗AI时代的数据基础设施", {
    x: 0.8, y: 2.6, w: 8.4, h: 0.5,
    fontSize: 18, fontFace: "Microsoft YaHei",
    color: theme.light, align: "center", valign: "middle", margin: 0
  });

  // Accent divider
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 3.8, y: 3.25, w: 2.4, h: 0.04,
    fill: { color: theme.accent }
  });

  // Value statement
  slide.addText("我们不是在建设一个数据平台，\n而是在建设医疗AI时代的数据基础设施。", {
    x: 0.8, y: 3.5, w: 8.4, h: 0.7,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: theme.accent, align: "center", valign: "middle",
    lineSpacingMultiple: 1.3, margin: 0
  });

  // Thank You
  slide.addText("Thank You", {
    x: 0.8, y: 4.4, w: 8.4, h: 0.5,
    fontSize: 28, fontFace: "Georgia",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Contact info
  slide.addText("MedTrust  |  医疗AI基础设施平台", {
    x: 0.8, y: 4.95, w: 8.4, h: 0.3,
    fontSize: 12, fontFace: "Microsoft YaHei",
    color: theme.light, align: "center", valign: "middle", margin: 0
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
  const theme = { primary: "03045e", secondary: "0077b6", accent: "00b4d8", light: "90e0ef", bg: "ffffff" };
  createSlide(pres, theme);
  pres.writeFile({ fileName: "slide-18-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
