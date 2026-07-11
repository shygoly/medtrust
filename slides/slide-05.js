const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 5,
  title: '医疗AI基础设施平台架构'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("医疗AI基础设施平台架构", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Product Architecture — 可信空间只是底座，AI能力才是未来价值", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Four-layer architecture
  const layers = [
    {
      name: "应用层",
      sub: "Applications",
      color: theme.accent,
      items: ["科研", "RWS", "精准医疗", "药物研发", "保险风控", "临床辅助", "智能医生"]
    },
    {
      name: "AI能力",
      sub: "AI Capabilities",
      color: theme.secondary,
      items: ["模型训练", "Agent", "知识库", "RAG", "模型管理", "AutoML"]
    },
    {
      name: "可信空间",
      sub: "Trusted Data Space",
      color: theme.primary,
      items: ["身份认证", "权限管理", "数据目录", "联邦计算", "隐私计算", "审计"]
    },
    {
      name: "数据层",
      sub: "Data Layer",
      color: theme.secondary,
      items: ["医院HIS", "EMR", "LIS", "PACS", "组学", "IoT"]
    }
  ];

  const layerY = 1.5, layerH = 0.75, layerGap = 0.1, layerX = 0.5, layerW = 8.5;

  layers.forEach((layer, i) => {
    const ly = layerY + (3 - i) * (layerH + layerGap);

    // Layer background
    slide.addShape(pres.shapes.RECTANGLE, {
      x: layerX, y: ly, w: layerW, h: layerH,
      fill: { color: layer.color, transparency: i === 2 ? 0 : 88 },
      line: { color: layer.color, width: 1.5 }
    });

    // Layer name (left side)
    slide.addText(layer.name, {
      x: layerX + 0.1, y: ly + 0.05, w: 1.5, h: 0.4,
      fontSize: 14, fontFace: "Microsoft YaHei",
      color: i === 2 ? "FFFFFF" : theme.primary,
      bold: true, align: "left", valign: "middle", margin: 0
    });
    slide.addText(layer.sub, {
      x: layerX + 0.1, y: ly + 0.42, w: 1.5, h: 0.25,
      fontSize: 9, fontFace: "Georgia",
      color: i === 2 ? theme.light : theme.secondary,
      align: "left", valign: "middle", margin: 0
    });

    // Divider line
    slide.addShape(pres.shapes.RECTANGLE, {
      x: layerX + 1.65, y: ly + 0.1, w: 0.02, h: layerH - 0.2,
      fill: { color: i === 2 ? theme.accent : layer.color, transparency: 50 }
    });

    // Items (right side)
    const itemStartX = layerX + 1.85;
    const itemW = 1.05, itemGap = 0.08;
    layer.items.forEach((item, j) => {
      const ix = itemStartX + j * (itemW + itemGap);
      slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
        x: ix, y: ly + 0.15, w: itemW, h: 0.45,
        fill: { color: i === 2 ? theme.accent : layer.color, transparency: i === 2 ? 60 : 80 },
        rectRadius: 0.05
      });
      slide.addText(item, {
        x: ix, y: ly + 0.15, w: itemW, h: 0.45,
        fontSize: 10, fontFace: "Microsoft YaHei",
        color: i === 2 ? "FFFFFF" : theme.primary,
        bold: true, align: "center", valign: "middle", margin: 0
      });
    });
  });

  // Highlight box for trusted space layer (middle layer)
  slide.addText("核心层", {
    x: 0.5, y: 1.5 + 1 * (layerH + layerGap) - 0.02, w: 0.5, h: 0.2,
    fontSize: 8, fontFace: "Microsoft YaHei",
    color: theme.accent, align: "left", margin: 0
  });

  // Bottom insight
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.75, w: 9, h: 0.45,
    fill: { color: theme.primary }
  });
  slide.addText("可信空间只是底座，AI能力才是未来价值。", {
    x: 0.5, y: 4.75, w: 9, h: 0.45,
    fontSize: 15, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("5", {
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
  pres.writeFile({ fileName: "slide-05-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
