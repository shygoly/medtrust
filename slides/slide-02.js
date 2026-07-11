const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 2,
  title: '医疗AI进入数据驱动时代'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("医疗AI进入数据驱动时代", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left",
    margin: 0
  });

  // Subtitle
  slide.addText("Why Now — 一个时代性的机会", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left",
    margin: 0
  });

  // Left column: Past decade
  const leftX = 0.5, colW = 4.2, colY = 1.55, colH = 2.6;
  slide.addShape(pres.shapes.RECTANGLE, {
    x: leftX, y: colY, w: colW, h: colH,
    fill: { color: theme.light, transparency: 60 },
    line: { color: theme.light, width: 1 }
  });
  slide.addText("过去十年", {
    x: leftX, y: colY + 0.15, w: colW, h: 0.4,
    fontSize: 18, fontFace: "Microsoft YaHei",
    color: theme.secondary, bold: true, align: "center",
    margin: 0
  });
  slide.addText("AI竞争核心", {
    x: leftX, y: colY + 0.6, w: colW, h: 0.35,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.secondary, align: "center", margin: 0
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: leftX + 1.2, y: colY + 1.0, w: colW - 2.4, h: 0.03,
    fill: { color: theme.secondary, transparency: 50 }
  });
  slide.addText("算法", {
    x: leftX, y: colY + 1.1, w: colW, h: 0.4,
    fontSize: 24, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "center", margin: 0
  });
  slide.addText("↓", {
    x: leftX, y: colY + 1.5, w: colW, h: 0.3,
    fontSize: 16, fontFace: "Arial",
    color: theme.secondary, align: "center", margin: 0
  });
  slide.addText("算力", {
    x: leftX, y: colY + 1.8, w: colW, h: 0.4,
    fontSize: 24, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "center", margin: 0
  });

  // Arrow between columns
  slide.addText("→", {
    x: 4.5, y: colY + 1.0, w: 1.0, h: 0.5,
    fontSize: 28, fontFace: "Arial",
    color: theme.accent, bold: true, align: "center", margin: 0
  });

  // Right column: Future decade
  const rightX = 5.3;
  slide.addShape(pres.shapes.RECTANGLE, {
    x: rightX, y: colY, w: colW, h: colH,
    fill: { color: theme.accent, transparency: 85 },
    line: { color: theme.accent, width: 1.5 }
  });
  slide.addText("未来十年", {
    x: rightX, y: colY + 0.15, w: colW, h: 0.4,
    fontSize: 18, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "center", margin: 0
  });
  slide.addText("AI竞争核心", {
    x: rightX, y: colY + 0.6, w: colW, h: 0.35,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.secondary, align: "center", margin: 0
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: rightX + 1.2, y: colY + 1.0, w: colW - 2.4, h: 0.03,
    fill: { color: theme.accent, transparency: 40 }
  });
  slide.addText("高质量医疗数据", {
    x: rightX, y: colY + 1.1, w: colW, h: 0.4,
    fontSize: 20, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "center", margin: 0
  });
  slide.addText("↓", {
    x: rightX, y: colY + 1.5, w: colW, h: 0.3,
    fontSize: 16, fontFace: "Arial",
    color: theme.accent, align: "center", margin: 0
  });
  slide.addText("可信协作能力", {
    x: rightX, y: colY + 1.8, w: colW, h: 0.4,
    fontSize: 20, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "center", margin: 0
  });

  // Key insight box
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.35, w: 9, h: 0.5,
    fill: { color: theme.primary }
  });
  slide.addText("AI模型越来越强，但高质量医疗数据越来越难获取。", {
    x: 0.5, y: 4.35, w: 9, h: 0.5,
    fontSize: 15, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle",
    margin: 0
  });

  // Industry trends bar (bottom)
  const trends = ["大模型快速发展", "医疗数据价值爆发", "数据安全法规完善", "医院数据共享受限"];
  const trendW = 2.15, trendGap = 0.1, trendStartX = 0.5;
  trends.forEach((t, i) => {
    const tx = trendStartX + i * (trendW + trendGap);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: tx, y: 4.95, w: trendW, h: 0.3,
      fill: { color: theme.light, transparency: 40 }
    });
    slide.addText(t, {
      x: tx, y: 4.95, w: trendW, h: 0.3,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "center", valign: "middle", margin: 0
    });
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("2", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 12, fontFace: "Arial",
    color: "FFFFFF", bold: true, align: "center", valign: "middle"
  });

  return slide;
}

if (require.main === module) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  const theme = { primary: "03045e", secondary: "0077b6", accent: "00b4d8", light: "90e0ef", bg: "ffffff" };
  createSlide(pres, theme);
  pres.writeFile({ fileName: "slide-02-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
