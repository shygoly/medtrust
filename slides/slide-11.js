const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 11,
  title: '一个平台，多种应用'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("一个平台，多种应用", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Application Scenarios — 从科研到临床，从药企到保险", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // 6 scenario cards (2x3 grid)
  const scenarios = [
    { name: "真实世界研究", desc: "多中心RWE数据协作", tag: "RWS", color: theme.primary },
    { name: "药物研发", desc: "靶点发现与临床试验", tag: "PHARMA", color: theme.secondary },
    { name: "精准医疗", desc: "基因组学+临床数据", tag: "PRECISION", color: theme.accent },
    { name: "商业保险", desc: "智能核保与风险定价", tag: "INSURANCE", color: theme.secondary },
    { name: "医院科研", desc: "跨机构科研协作", tag: "RESEARCH", color: theme.primary },
    { name: "医疗Agent", desc: "AI辅助诊疗智能体", tag: "AGENT", color: theme.accent }
  ];

  const cardW = 2.8, cardH = 1.5, cardGapX = 0.2, cardGapY = 0.2;
  const startX = 0.5, startY = 1.55;
  const perRow = 3;

  scenarios.forEach((s, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const sx = startX + col * (cardW + cardGapX);
    const sy = startY + row * (cardH + cardGapY);

    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: sy, w: cardW, h: cardH,
      fill: { color: theme.light, transparency: 55 },
      line: { color: s.color, width: 1.5 }
    });

    // Left accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: sy, w: 0.06, h: cardH,
      fill: { color: s.color }
    });

    // Tag badge (top-right)
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: sx + cardW - 1.1, y: sy + 0.12, w: 0.95, h: 0.28,
      fill: { color: s.color },
      rectRadius: 0.04
    });
    slide.addText(s.tag, {
      x: sx + cardW - 1.1, y: sy + 0.12, w: 0.95, h: 0.28,
      fontSize: 8, fontFace: "Georgia",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });

    // Scenario name
    slide.addText(s.name, {
      x: sx + 0.25, y: sy + 0.15, w: cardW - 1.4, h: 0.4,
      fontSize: 15, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", valign: "middle", margin: 0
    });

    // Icon area (visual element)
    slide.addShape(pres.shapes.OVAL, {
      x: sx + 0.25, y: sy + 0.65, w: 0.5, h: 0.5,
      fill: { color: s.color, transparency: 75 },
      line: { color: s.color, width: 1 }
    });
    slide.addText(String(i + 1), {
      x: sx + 0.25, y: sy + 0.65, w: 0.5, h: 0.5,
      fontSize: 14, fontFace: "Georgia",
      color: s.color, bold: true, align: "center", valign: "middle"
    });

    // Description
    slide.addText(s.desc, {
      x: sx + 0.9, y: sy + 0.65, w: cardW - 1.1, h: 0.5,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "middle", margin: 0
    });
  });

  // Bottom insight
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.0, w: 9, h: 0.0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("11", {
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
  pres.writeFile({ fileName: "slide-11-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
