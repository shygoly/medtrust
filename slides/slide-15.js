const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 15,
  title: '本轮融资'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("本轮融资", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Funding Plan — 未来18个月目标", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Left: Funding amount + pie chart
  const leftX = 0.5, leftW = 4.3;

  // Funding amount card
  slide.addShape(pres.shapes.RECTANGLE, {
    x: leftX, y: 1.55, w: leftW, h: 1.2,
    fill: { color: theme.primary },
    shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 90, opacity: 0.15 }
  });
  slide.addText("融资金额", {
    x: leftX + 0.2, y: 1.65, w: leftW - 0.4, h: 0.3,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.light, align: "left", margin: 0
  });
  slide.addText("3,000万", {
    x: leftX + 0.2, y: 1.95, w: 2.5, h: 0.65,
    fontSize: 36, fontFace: "Georgia",
    color: "FFFFFF", bold: true, align: "left", valign: "middle", margin: 0
  });
  slide.addText("人民币", {
    x: leftX + 2.5, y: 2.05, w: 1.0, h: 0.5,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: theme.accent, align: "left", valign: "middle", margin: 0
  });

  // Pie chart
  const allocations = [
    { label: "产品研发", pct: 40, color: theme.primary },
    { label: "市场拓展", pct: 30, color: theme.accent },
    { label: "医院合作", pct: 20, color: theme.secondary },
    { label: "运营", pct: 10, color: theme.light }
  ];

  // Simple visual bar representation of allocations
  const barY = 3.0, barH = 0.5, barX = leftX, barW = leftW;
  let currentX = barX;

  allocations.forEach((a) => {
    const segW = barW * (a.pct / 100);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: currentX, y: barY, w: segW, h: barH,
      fill: { color: a.color }
    });
    slide.addText(a.pct + "%", {
      x: currentX, y: barY, w: segW, h: barH,
      fontSize: 12, fontFace: "Georgia",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
    currentX += segW;
  });

  // Allocation legend
  allocations.forEach((a, i) => {
    const ly = 3.65 + i * 0.32;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: leftX + 0.1, y: ly, w: 0.2, h: 0.2,
      fill: { color: a.color }
    });
    slide.addText(a.label + " — " + a.pct + "%", {
      x: leftX + 0.4, y: ly, w: 2.5, h: 0.2,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.primary, align: "left", valign: "middle", margin: 0
    });
  });

  // Right: 18-month goals
  const rightX = 5.2, rightW = 4.3;
  slide.addText("未来18个月目标", {
    x: rightX, y: 1.55, w: rightW, h: 0.35,
    fontSize: 16, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  const goals = [
    { num: "1", title: "产品上线", desc: "可信空间平台正式商用" },
    { num: "2", title: "医院拓展", desc: "签约XX家三甲医院" },
    { num: "3", title: "AI能力", desc: "完成模型训练平台与Agent" },
    { num: "4", title: "生态合作", desc: "接入XX家AI企业与药企" },
    { num: "5", title: "收入验证", desc: "实现可持续商业收入" }
  ];

  goals.forEach((g, i) => {
    const gy = 2.0 + i * 0.6;

    // Number badge
    slide.addShape(pres.shapes.OVAL, {
      x: rightX, y: gy, w: 0.4, h: 0.4,
      fill: { color: theme.accent }
    });
    slide.addText(g.num, {
      x: rightX, y: gy, w: 0.4, h: 0.4,
      fontSize: 14, fontFace: "Georgia",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });

    // Goal title
    slide.addText(g.title, {
      x: rightX + 0.55, y: gy, w: 1.5, h: 0.4,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", valign: "middle", margin: 0
    });

    // Goal description
    slide.addText(g.desc, {
      x: rightX + 2.0, y: gy, w: rightW - 2.0, h: 0.4,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "middle", margin: 0
    });
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("15", {
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
  pres.writeFile({ fileName: "slide-15-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
