const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 9,
  title: '平台为什么越来越值钱？'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("平台为什么越来越值钱？", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 30, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Network Effect — 飞轮效应，强者恒强", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Flywheel diagram (circular layout)
  const cx = 5.0, cy = 3.0, radius = 1.5;
  const steps = [
    { label: "医院增加", angle: 0 },
    { label: "数据增加", angle: 60 },
    { label: "模型更好", angle: 120 },
    { label: "AI企业增加", angle: 180 },
    { label: "应用增加", angle: 240 },
    { label: "更多医院加入", angle: 300 }
  ];

  // Draw circular arrows (arcs simulated with lines)
  steps.forEach((s, i) => {
    const next = steps[(i + 1) % steps.length];
    const rad = (s.angle - 90) * Math.PI / 180;
    const nextRad = (next.angle - 90) * Math.PI / 180;
    const x1 = cx + radius * Math.cos(rad);
    const y1 = cy + radius * Math.sin(rad);
    const x2 = cx + radius * Math.cos(nextRad);
    const y2 = cy + radius * Math.sin(nextRad);

    // Connecting line
    slide.addShape(pres.shapes.LINE, {
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      line: { color: theme.accent, width: 1.5, dashType: "dash" }
    });
  });

  // Center hub
  slide.addShape(pres.shapes.OVAL, {
    x: cx - 0.55, y: cy - 0.55, w: 1.1, h: 1.1,
    fill: { color: theme.primary },
    shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 90, opacity: 0.2 }
  });
  slide.addText("Network\nEffect", {
    x: cx - 0.55, y: cy - 0.4, w: 1.1, h: 0.8,
    fontSize: 12, fontFace: "Georgia",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Step nodes around the circle
  steps.forEach((s, i) => {
    const rad = (s.angle - 90) * Math.PI / 180;
    const nx = cx + radius * Math.cos(rad);
    const ny = cy + radius * Math.sin(rad);
    const nw = 1.3, nh = 0.5;

    // Node background
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: nx - nw / 2, y: ny - nh / 2, w: nw, h: nh,
      fill: { color: theme.light, transparency: 30 },
      line: { color: theme.accent, width: 1.5 },
      rectRadius: 0.08
    });
    // Number badge
    slide.addShape(pres.shapes.OVAL, {
      x: nx - nw / 2 - 0.05, y: ny - nh / 2 - 0.05, w: 0.25, h: 0.25,
      fill: { color: theme.accent }
    });
    slide.addText(String(i + 1), {
      x: nx - nw / 2 - 0.05, y: ny - nh / 2 - 0.05, w: 0.25, h: 0.25,
      fontSize: 9, fontFace: "Arial",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });
    // Label
    slide.addText(s.label, {
      x: nx - nw / 2, y: ny - nh / 2, w: nw, h: nh,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });
  });

  // Right side: cycle label
  slide.addText("正向循环", {
    x: 7.5, y: 2.7, w: 1.5, h: 0.3,
    fontSize: 12, fontFace: "Microsoft YaHei",
    color: theme.accent, bold: true, align: "center", margin: 0
  });
  slide.addText("→ Self-reinforcing", {
    x: 7.5, y: 3.0, w: 1.5, h: 0.3,
    fontSize: 10, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "center", margin: 0
  });

  // Bottom insight
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.85, w: 9, h: 0.4,
    fill: { color: theme.primary }
  });
  slide.addText("每增加一个医院节点，整个平台的价值呈指数级增长。", {
    x: 0.5, y: 4.85, w: 9, h: 0.4,
    fontSize: 14, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("9", {
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
  pres.writeFile({ fileName: "slide-09-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
