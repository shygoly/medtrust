const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 6,
  title: '医疗可信数据市场'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("医疗可信数据市场", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Market Opportunity — 我们服务的是整个医疗产业，而不是医院软件市场", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Left: Industry chain (vertical flow)
  const chainX = 0.5, chainW = 4.2, chainY = 1.55;
  slide.addText("产业链上下游", {
    x: chainX, y: chainY - 0.1, w: chainW, h: 0.3,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  const chain = ["医院", "可信空间", "AI企业", "药企", "保险", "器械", "科研", "政府"];
  chain.forEach((node, i) => {
    const ny = chainY + 0.25 + i * 0.36;
    const isPlatform = node === "可信空间";

    if (isPlatform) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: chainX + 0.3, y: ny, w: chainW - 0.6, h: 0.3,
        fill: { color: theme.primary }
      });
      slide.addText(node, {
        x: chainX + 0.3, y: ny, w: chainW - 0.6, h: 0.3,
        fontSize: 12, fontFace: "Microsoft YaHei",
        color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
      });
    } else {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: chainX + 0.5, y: ny, w: chainW - 1.0, h: 0.3,
        fill: { color: theme.light, transparency: 50 },
        line: { color: theme.secondary, width: 0.5 }
      });
      slide.addText(node, {
        x: chainX + 0.5, y: ny, w: chainW - 1.0, h: 0.3,
        fontSize: 11, fontFace: "Microsoft YaHei",
        color: theme.primary, align: "center", valign: "middle", margin: 0
      });
    }

    if (i < chain.length - 1) {
      slide.addText("↓", {
        x: chainX, y: ny + 0.28, w: chainW, h: 0.12,
        fontSize: 10, fontFace: "Arial",
        color: theme.accent, align: "center", margin: 0
      });
    }
  });

  // Right: Market size stat callouts
  const rightX = 5.2, rightW = 4.3;
  slide.addText("市场规模", {
    x: rightX, y: 1.45, w: rightW, h: 0.3,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  const markets = [
    { label: "中国医疗数字化", value: "千亿级", unit: "元", desc: "医院信息化基础投入", color: theme.primary },
    { label: "医疗AI", value: "数百亿", unit: "元", desc: "AI诊断、药物研发等", color: theme.secondary },
    { label: "数据要素市场", value: "万亿级", unit: "潜力", desc: "国家数据要素战略", color: theme.accent }
  ];

  markets.forEach((m, i) => {
    const my = 1.85 + i * 1.05;
    // Card background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y: my, w: rightW, h: 0.9,
      fill: { color: theme.light, transparency: 60 },
      line: { color: m.color, width: 1 }
    });
    // Left accent bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y: my, w: 0.06, h: 0.9,
      fill: { color: m.color }
    });
    // Label
    slide.addText(m.label, {
      x: rightX + 0.2, y: my + 0.08, w: rightW - 0.3, h: 0.3,
      fontSize: 12, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", margin: 0
    });
    // Big value
    slide.addText(m.value, {
      x: rightX + 0.2, y: my + 0.35, w: 2.0, h: 0.45,
      fontSize: 26, fontFace: "Georgia",
      color: m.color, bold: true, align: "left", margin: 0
    });
    // Unit
    slide.addText(m.unit, {
      x: rightX + 2.0, y: my + 0.42, w: 1.0, h: 0.35,
      fontSize: 12, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "middle", margin: 0
    });
    // Description
    slide.addText(m.desc, {
      x: rightX + 0.2, y: my + 0.72, w: rightW - 0.3, h: 0.2,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", margin: 0
    });
  });

  // Bottom insight
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.95, w: 9, h: 0.35,
    fill: { color: theme.primary }
  });
  slide.addText("我们服务的是整个医疗产业，而不是医院软件市场。", {
    x: 0.5, y: 4.95, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("6", {
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
  pres.writeFile({ fileName: "slide-06-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
