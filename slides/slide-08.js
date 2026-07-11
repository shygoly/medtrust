const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 8,
  title: '五层护城河'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("五层护城河", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Technology Moat — 多重壁垒，越深越宽", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // 5-layer pyramid (inverted, widest at bottom)
  const layers = [
    { name: "监管能力", desc: "监管认证形成准入门槛", w: 2.0, color: theme.accent },
    { name: "生态", desc: "生态越繁荣，平台越强", w: 3.0, color: theme.secondary },
    { name: "AI模型", desc: "模型越训练越好", w: 4.0, color: theme.primary },
    { name: "数据标准", desc: "标准越统一，迁移成本越高", w: 5.0, color: theme.secondary },
    { name: "医院网络", desc: "医院越多，价值越高", w: 6.0, color: theme.primary }
  ];

  const pyramidCenterX = 5.0;
  const pyramidTopY = 1.55;
  const layerH = 0.6;
  const layerGap = 0.05;

  layers.forEach((layer, i) => {
    const ly = pyramidTopY + i * (layerH + layerGap);
    const lx = pyramidCenterX - layer.w / 2;

    // Layer bar
    slide.addShape(pres.shapes.RECTANGLE, {
      x: lx, y: ly, w: layer.w, h: layerH,
      fill: { color: layer.color, transparency: i < 2 ? 70 : 15 },
      line: { color: layer.color, width: 1 }
    });

    // Layer name (centered in bar)
    slide.addText(layer.name, {
      x: lx, y: ly, w: layer.w, h: layerH,
      fontSize: 14, fontFace: "Microsoft YaHei",
      color: i < 2 ? theme.primary : "FFFFFF",
      bold: true, align: "center", valign: "middle", margin: 0
    });

    // Description (right side, outside pyramid)
    slide.addText(layer.desc, {
      x: pyramidCenterX + 3.2, y: ly, w: 1.5, h: layerH,
      fontSize: 10, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "middle", margin: 0
    });

    // Left side label (level number)
    slide.addText("L" + (5 - i), {
      x: pyramidCenterX - 3.2 - 0.5, y: ly, w: 0.5, h: layerH,
      fontSize: 12, fontFace: "Georgia",
      color: theme.accent, bold: true, align: "right", valign: "middle", margin: 0
    });
  });

  // Left side: descriptive arrow
  slide.addShape(pres.shapes.LINE, {
    x: 1.5, y: 1.55, w: 0, h: 3.25,
    line: { color: theme.accent, width: 2 }
  });
  slide.addText("越深", {
    x: 0.8, y: 1.8, w: 0.7, h: 0.3,
    fontSize: 11, fontFace: "Microsoft YaHei",
    color: theme.accent, bold: true, align: "center", margin: 0
  });
  slide.addText("越宽", {
    x: 0.8, y: 4.3, w: 0.7, h: 0.3,
    fontSize: 11, fontFace: "Microsoft YaHei",
    color: theme.accent, bold: true, align: "center", margin: 0
  });
  slide.addText("↓", {
    x: 0.8, y: 2.1, w: 0.7, h: 0.3,
    fontSize: 14, fontFace: "Arial",
    color: theme.accent, align: "center", margin: 0
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
  slide.addText("8", {
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
  pres.writeFile({ fileName: "slide-08-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
