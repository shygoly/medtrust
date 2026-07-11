const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 13,
  title: 'Traction'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("商业进展", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Traction — 从0到1的验证", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // 6 stat callouts in 2x3 grid
  const stats = [
    { value: "XX", unit: "家", label: "已合作医院", desc: "正式签约", color: theme.primary },
    { value: "XX", unit: "家", label: "接触医院", desc: "Pipeline中", color: theme.secondary },
    { value: "XX", unit: "个", label: "PoC验证", desc: "概念验证完成", color: theme.accent },
    { value: "XX", unit: "家", label: "合作伙伴", desc: "生态合作", color: theme.secondary },
    { value: "XX", unit: "TB", label: "数据量", desc: "已接入数据", color: theme.primary },
    { value: "XX", unit: "项", label: "科研项目", desc: "在研项目", color: theme.accent }
  ];

  const cardW = 2.85, cardH = 1.55, cardGapX = 0.15, cardGapY = 0.2;
  const startX = 0.5, startY = 1.55;
  const perRow = 3;

  stats.forEach((s, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const sx = startX + col * (cardW + cardGapX);
    const sy = startY + row * (cardH + cardGapY);

    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: sy, w: cardW, h: cardH,
      fill: { color: theme.light, transparency: 55 },
      line: { color: s.color, width: 1 }
    });

    // Left accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: sy, w: 0.06, h: cardH,
      fill: { color: s.color }
    });

    // Big value
    slide.addText(s.value, {
      x: sx + 0.2, y: sy + 0.15, w: 1.6, h: 0.65,
      fontSize: 40, fontFace: "Georgia",
      color: s.color, bold: true, align: "left", valign: "middle", margin: 0
    });

    // Unit
    slide.addText(s.unit, {
      x: sx + 1.6, y: sy + 0.25, w: 0.8, h: 0.5,
      fontSize: 16, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "middle", margin: 0
    });

    // Divider line
    slide.addShape(pres.shapes.RECTANGLE, {
      x: sx + 0.2, y: sy + 0.85, w: cardW - 0.4, h: 0.02,
      fill: { color: s.color, transparency: 50 }
    });

    // Label
    slide.addText(s.label, {
      x: sx + 0.2, y: sy + 0.95, w: cardW - 0.3, h: 0.3,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", margin: 0
    });

    // Description
    slide.addText(s.desc, {
      x: sx + 0.2, y: sy + 1.2, w: cardW - 0.3, h: 0.25,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", margin: 0
    });
  });

  // Bottom note
  slide.addText("注：以上数据为示例占位，实际数据请根据公司最新进展填写。", {
    x: 0.5, y: 5.0, w: 9, h: 0.25,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("13", {
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
  pres.writeFile({ fileName: "slide-13-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
