const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 17,
  title: '为什么现在投资我们？'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.primary };

  // Decorative element (top-right)
  slide.addShape(pres.shapes.OVAL, {
    x: 7.8, y: -0.5, w: 3.0, h: 3.0,
    fill: { color: theme.accent, transparency: 90 }
  });

  // Title
  slide.addText("为什么现在投资我们？", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 30, fontFace: "Microsoft YaHei",
    color: "FFFFFF", bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Why Invest Now", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.accent, italic: true, align: "left", margin: 0
  });

  // 5 key statements
  const statements = [
    "医疗AI最大的瓶颈已经从算法转向数据。",
    "数据安全法规让可信流通成为刚需。",
    "医疗可信空间将成为医疗AI时代的新基础设施。",
    "平台将形成医院网络、数据网络和AI生态三重网络效应。",
    "我们正在建设医疗行业未来的数据操作系统。"
  ];

  statements.forEach((s, i) => {
    const sy = 1.55 + i * 0.68;

    // Number badge
    slide.addShape(pres.shapes.OVAL, {
      x: 0.5, y: sy, w: 0.4, h: 0.4,
      fill: { color: theme.accent }
    });
    slide.addText(String(i + 1), {
      x: 0.5, y: sy, w: 0.4, h: 0.4,
      fontSize: 14, fontFace: "Georgia",
      color: theme.primary, bold: true, align: "center", valign: "middle"
    });

    // Statement text
    slide.addText(s, {
      x: 1.1, y: sy, w: 8.0, h: 0.4,
      fontSize: 15, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "left", valign: "middle", margin: 0
    });

    // Subtle divider line
    if (i < statements.length - 1) {
      slide.addShape(pres.shapes.RECTANGLE, {
        x: 1.1, y: sy + 0.5, w: 7.5, h: 0.01,
        fill: { color: theme.accent, transparency: 75 }
      });
    }
  });

  // Bottom emphasis
  slide.addText("Build the Infrastructure of Medical AI.", {
    x: 0.5, y: 5.05, w: 9, h: 0.35,
    fontSize: 14, fontFace: "Georgia",
    color: theme.accent, italic: true, bold: true, align: "center", margin: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("17", {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fontSize: 12, fontFace: "Arial",
    color: theme.primary, bold: true, align: "center", valign: "middle"
  });

  return slide;
}

if (require.main === module) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  const theme = { primary: "03045e", secondary: "0077b6", accent: "00b4d8", light: "90e0ef", bg: "ffffff" };
  createSlide(pres, theme);
  pres.writeFile({ fileName: "slide-17-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
