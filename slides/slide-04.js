const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 4,
  title: '医疗可信空间——让数据可用不可见'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("医疗可信空间——让数据可用不可见", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 30, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("The Solution — 数据不出域，算法进数据", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Central platform node
  const centerX = 3.7, centerY = 2.0, centerW = 2.6, centerH = 1.4;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: centerX, y: centerY, w: centerW, h: centerH,
    fill: { color: theme.primary },
    rectRadius: 0.1,
    shadow: { type: "outer", color: "000000", blur: 8, offset: 3, angle: 90, opacity: 0.2 }
  });
  slide.addText("Medical\nTrusted Data Space", {
    x: centerX, y: centerY + 0.1, w: centerW, h: 0.8,
    fontSize: 16, fontFace: "Georgia",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });
  slide.addText("医疗可信空间", {
    x: centerX, y: centerY + 0.85, w: centerW, h: 0.4,
    fontSize: 13, fontFace: "Microsoft YaHei",
    color: theme.accent, align: "center", valign: "middle", margin: 0
  });

  // Surrounding stakeholder nodes (hexagon-like using rectangles)
  const stakeholders = [
    { label: "医院", x: 0.5, y: 1.7 },
    { label: "AI企业", x: 0.5, y: 3.2 },
    { label: "药企", x: 5.0, y: 1.4 },
    { label: "保险", x: 7.8, y: 1.7 },
    { label: "科研", x: 7.8, y: 3.2 },
    { label: "监管机构", x: 5.0, y: 3.7 }
  ];

  stakeholders.forEach((s) => {
    const sw = 1.4, sh = 0.55;
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: s.x, y: s.y, w: sw, h: sh,
      fill: { color: theme.accent, transparency: 80 },
      line: { color: theme.accent, width: 1.5 },
      rectRadius: 0.08
    });
    slide.addText(s.label, {
      x: s.x, y: s.y, w: sw, h: sh,
      fontSize: 13, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });
  });

  // Connecting lines from center to stakeholders
  const centerNodeX = centerX + centerW / 2;
  const centerNodeY = centerY + centerH / 2;
  stakeholders.forEach((s) => {
    const targetX = s.x + 0.7;
    const targetY = s.y + 0.275;
    slide.addShape(pres.shapes.LINE, {
      x: Math.min(centerNodeX, targetX),
      y: centerNodeY,
      w: Math.abs(targetX - centerNodeX),
      h: targetY - centerNodeY,
      line: { color: theme.accent, width: 1, dashType: "dash" }
    });
  });

  // Value proposition bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 4.3, w: 9, h: 0.45,
    fill: { color: theme.primary }
  });
  slide.addText("数据不出域，算法进数据。", {
    x: 0.5, y: 4.3, w: 9, h: 0.45,
    fontSize: 16, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
  });

  // Five attributes
  const attrs = ["可用", "不可见", "可控", "可追溯", "合规"];
  const attrW = 1.68, attrGap = 0.12, attrStartX = 0.5;
  attrs.forEach((a, i) => {
    const ax = attrStartX + i * (attrW + attrGap);
    slide.addShape(pres.shapes.RECTANGLE, {
      x: ax, y: 4.85, w: attrW, h: 0.35,
      fill: { color: theme.accent, transparency: 75 }
    });
    slide.addText(a, {
      x: ax, y: 4.85, w: attrW, h: 0.35,
      fontSize: 12, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("4", {
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
  pres.writeFile({ fileName: "slide-04-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
