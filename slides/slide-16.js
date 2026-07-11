const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 16,
  title: '核心团队'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("核心团队", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Team — 医疗 + AI + 数据安全，复合型团队", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // 4 team member cards (top row)
  const members = [
    { role: "医疗", desc: "三甲医院信息化\n临床数据经验", color: theme.primary },
    { role: "AI", desc: "大模型训练\n医疗AI研发", color: theme.accent },
    { role: "数据安全", desc: "隐私计算\n数据合规", color: theme.secondary },
    { role: "产业资源", desc: "医院网络\n行业经验", color: theme.primary }
  ];

  const cardW = 2.1, cardH = 1.6, cardGapX = 0.15;
  const startX = 0.5, startY = 1.55;

  members.forEach((m, i) => {
    const mx = startX + i * (cardW + cardGapX);

    // Card
    slide.addShape(pres.shapes.RECTANGLE, {
      x: mx, y: startY, w: cardW, h: cardH,
      fill: { color: theme.light, transparency: 55 },
      line: { color: m.color, width: 1.5 }
    });

    // Avatar circle (placeholder)
    slide.addShape(pres.shapes.OVAL, {
      x: mx + cardW / 2 - 0.35, y: startY + 0.15, w: 0.7, h: 0.7,
      fill: { color: m.color, transparency: 70 },
      line: { color: m.color, width: 1.5 }
    });
    slide.addText(String(i + 1), {
      x: mx + cardW / 2 - 0.35, y: startY + 0.15, w: 0.7, h: 0.7,
      fontSize: 20, fontFace: "Georgia",
      color: m.color, bold: true, align: "center", valign: "middle"
    });

    // Role
    slide.addText(m.role, {
      x: mx, y: startY + 0.9, w: cardW, h: 0.3,
      fontSize: 14, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });

    // Description
    slide.addText(m.desc, {
      x: mx + 0.15, y: startY + 1.2, w: cardW - 0.3, h: 0.35,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "center", valign: "middle", margin: 0
    });
  });

  // Advisors section
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 3.45, w: 9, h: 0.04,
    fill: { color: theme.accent, transparency: 50 }
  });

  slide.addText("顾问团队", {
    x: 0.5, y: 3.6, w: 9, h: 0.35,
    fontSize: 16, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  const advisors = [
    { title: "院士", desc: "医学信息学领域", x: 0.5 },
    { title: "教授", desc: "AI与医疗交叉学科", x: 3.4 },
    { title: "医院专家", desc: "三甲医院信息中心主任", x: 6.3 }
  ];

  advisors.forEach((a) => {
    const aw = 2.7;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: a.x, y: 4.05, w: aw, h: 0.8,
      fill: { color: theme.light, transparency: 60 },
      line: { color: theme.secondary, width: 0.5 }
    });
    // Left accent
    slide.addShape(pres.shapes.RECTANGLE, {
      x: a.x, y: 4.05, w: 0.05, h: 0.8,
      fill: { color: theme.accent }
    });
    slide.addText(a.title, {
      x: a.x + 0.2, y: 4.1, w: aw - 0.3, h: 0.35,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", margin: 0
    });
    slide.addText(a.desc, {
      x: a.x + 0.2, y: 4.45, w: aw - 0.3, h: 0.3,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", margin: 0
    });
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("16", {
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
  pres.writeFile({ fileName: "slide-16-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
