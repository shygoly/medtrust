const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 3,
  title: '医疗AI面临的数据困境'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("医疗AI面临的数据困境", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("行业最大矛盾：数据需求不断增加，数据流动越来越困难", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Left: Contradiction flow diagram
  const flowX = 0.5, flowW = 4.5, flowStartY = 1.55;
  const nodes = [
    { label: "AI企业", sub: "需要大量数据", color: theme.accent },
    { label: "医院", sub: "不能开放数据", color: theme.secondary },
    { label: "法律法规", sub: "不能随意共享", color: theme.primary },
    { label: "患者", sub: "隐私保护要求", color: theme.secondary }
  ];

  nodes.forEach((n, i) => {
    const ny = flowStartY + i * 0.85;
    // Node box
    slide.addShape(pres.shapes.RECTANGLE, {
      x: flowX + 0.3, y: ny, w: flowW - 0.6, h: 0.6,
      fill: { color: n.color, transparency: 85 },
      line: { color: n.color, width: 1.5 }
    });
    slide.addText(n.label, {
      x: flowX + 0.3, y: ny, w: flowW - 0.6, h: 0.35,
      fontSize: 15, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", margin: 0
    });
    slide.addText(n.sub, {
      x: flowX + 0.3, y: ny + 0.32, w: flowW - 0.6, h: 0.25,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "center", margin: 0
    });
    // Arrow down (except last)
    if (i < nodes.length - 1) {
      slide.addText("↓", {
        x: flowX, y: ny + 0.6, w: flowW, h: 0.25,
        fontSize: 14, fontFace: "Arial",
        color: theme.accent, align: "center", margin: 0
      });
    }
  });

  // Right: Pain points cards
  const rightX = 5.4, rightW = 4.1;
  slide.addText("核心痛点", {
    x: rightX, y: 1.4, w: rightW, h: 0.35,
    fontSize: 16, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  const pains = [
    { title: "数据孤岛", desc: "医院间数据完全隔离" },
    { title: "数据无法流通", desc: "缺乏合规流通通道" },
    { title: "数据标准不统一", desc: "格式各异，难以互操作" },
    { title: "多中心科研困难", desc: "跨机构协作成本极高" },
    { title: "AI训练成本高", desc: "数据获取成为最大瓶颈" }
  ];

  pains.forEach((p, i) => {
    const py = 1.8 + i * 0.55;
    // Card
    slide.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y: py, w: rightW, h: 0.45,
      fill: { color: theme.light, transparency: 55 }
    });
    // Accent dot
    slide.addShape(pres.shapes.OVAL, {
      x: rightX + 0.15, y: py + 0.14, w: 0.16, h: 0.16,
      fill: { color: theme.accent }
    });
    slide.addText(p.title, {
      x: rightX + 0.45, y: py, w: 1.6, h: 0.45,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", valign: "middle", margin: 0
    });
    slide.addText(p.desc, {
      x: rightX + 2.0, y: py, w: rightW - 2.1, h: 0.45,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "middle", margin: 0
    });
  });

  // Bottom insight
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.7, w: 9, h: 0.5,
    fill: { color: theme.primary }
  });
  slide.addText("数据不能流动，医疗AI就无法持续进化。", {
    x: 0.5, y: 4.7, w: 9, h: 0.5,
    fontSize: 16, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("3", {
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
  pres.writeFile({ fileName: "slide-03-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
