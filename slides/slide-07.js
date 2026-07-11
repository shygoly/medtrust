const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 7,
  title: '平台经济，而非软件销售'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("平台经济，而非软件销售", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Business Model — 多元收入结构，平台飞轮驱动", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Central platform node
  const centerX = 3.8, centerY = 1.7, centerW = 2.4, centerH = 1.0;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: centerX, y: centerY, w: centerW, h: centerH,
    fill: { color: theme.primary },
    rectRadius: 0.1,
    shadow: { type: "outer", color: "000000", blur: 8, offset: 3, angle: 90, opacity: 0.2 }
  });
  slide.addText("Trusted Space", {
    x: centerX, y: centerY + 0.1, w: centerW, h: 0.4,
    fontSize: 18, fontFace: "Georgia",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });
  slide.addText("可信空间平台", {
    x: centerX, y: centerY + 0.5, w: centerW, h: 0.35,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.accent, align: "center", valign: "middle", margin: 0
  });

  // Revenue stream cards (around platform)
  const revenues = [
    { client: "医院", fee: "建设费 + 运维费", x: 0.5, y: 1.6 },
    { client: "AI企业", fee: "计算费用 + API + 模型训练", x: 0.5, y: 2.85 },
    { client: "药企", fee: "真实世界研究", x: 0.5, y: 4.1 },
    { client: "保险", fee: "风险分析", x: 7.1, y: 1.6 },
    { client: "科研", fee: "数据分析", x: 7.1, y: 2.85 },
    { client: "政府", fee: "数据治理", x: 7.1, y: 4.1 }
  ];

  revenues.forEach((r) => {
    const rw = 2.2, rh = 0.95;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: r.x, y: r.y, w: rw, h: rh,
      fill: { color: theme.light, transparency: 55 },
      line: { color: theme.accent, width: 1 }
    });
    // Client name
    slide.addText(r.client, {
      x: r.x + 0.15, y: r.y + 0.08, w: rw - 0.3, h: 0.3,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", margin: 0
    });
    // Fee
    slide.addText(r.fee, {
      x: r.x + 0.15, y: r.y + 0.38, w: rw - 0.3, h: 0.45,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "top", margin: 0
    });
  });

  // Bottom: Future revenue sources bar
  slide.addText("未来收入来源", {
    x: 0.5, y: 4.9, w: 2.0, h: 0.3,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  const sources = ["SaaS", "PaaS", "API", "模型服务", "Agent Marketplace", "数据资产管理"];
  const srcW = 1.3, srcGap = 0.1, srcStartX = 2.5;
  sources.forEach((s, i) => {
    const sx = srcStartX + i * (srcW + srcGap);
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: sx, y: 4.9, w: srcW, h: 0.3,
      fill: { color: theme.accent, transparency: 75 },
      rectRadius: 0.05
    });
    slide.addText(s, {
      x: sx, y: 4.9, w: srcW, h: 0.3,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("7", {
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
  pres.writeFile({ fileName: "slide-07-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
