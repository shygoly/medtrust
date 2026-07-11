const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 10,
  title: '产品演示'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("产品演示", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Product Demo — 一个平台，全流程覆盖", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // 7 product module cards (2 rows: 4 + 3)
  const modules = [
    { name: "可信空间管理", desc: "统一管控平台入口", icon: "[MGT]" },
    { name: "数据目录", desc: "数据资产编目与检索", icon: "CAT" },
    { name: "数据授权", desc: "精细化权限与审批", icon: "AUTH" },
    { name: "计算任务", desc: "联邦计算任务调度", icon: "COMP" },
    { name: "模型训练", desc: "隐私保护下的AI训练", icon: "ML" },
    { name: "AI Agent", desc: "智能体编排与执行", icon: "AGENT" },
    { name: "数据资产", desc: "数据资产化管理", icon: "ASSET" }
  ];

  const cardW = 2.1, cardH = 1.5, cardGapX = 0.15, cardGapY = 0.2;
  const startX = 0.5, startY = 1.55;
  const perRow = 4;

  modules.forEach((m, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const mx = startX + col * (cardW + cardGapX);
    const my = startY + row * (cardH + cardGapY);

    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: mx, y: my, w: cardW, h: cardH,
      fill: { color: theme.light, transparency: 60 },
      line: { color: theme.accent, width: 1 }
    });

    // Top accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: mx, y: my, w: cardW, h: 0.05,
      fill: { color: theme.accent }
    });

    // Icon placeholder (mock screenshot area)
    slide.addShape(pres.shapes.RECTANGLE, {
      x: mx + 0.2, y: my + 0.2, w: cardW - 0.4, h: 0.55,
      fill: { color: theme.primary, transparency: 85 },
      line: { color: theme.secondary, width: 0.5 }
    });
    slide.addText(m.icon, {
      x: mx + 0.2, y: my + 0.2, w: cardW - 0.4, h: 0.55,
      fontSize: 14, fontFace: "Georgia",
      color: theme.accent, bold: true, align: "center", valign: "middle", margin: 0
    });

    // Module name
    slide.addText(m.name, {
      x: mx, y: my + 0.85, w: cardW, h: 0.3,
      fontSize: 12, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });

    // Description
    slide.addText(m.desc, {
      x: mx + 0.1, y: my + 1.15, w: cardW - 0.2, h: 0.25,
      fontSize: 9, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "center", valign: "middle", margin: 0
    });
  });

  // Bottom note
  slide.addText("注：实际演示中展示产品界面截图，此处为模块概览。", {
    x: 0.5, y: 5.0, w: 9, h: 0.25,
    fontSize: 10, fontFace: "Microsoft YaHei",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("10", {
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
  pres.writeFile({ fileName: "slide-10-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
