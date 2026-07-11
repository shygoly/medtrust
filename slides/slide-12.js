const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 12,
  title: '为什么是我们？'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("为什么是我们？", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Competitive Analysis — 不是软件，不是隐私计算，而是平台", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Comparison table
  const tableY = 1.55;
  const colW = [1.8, 1.9, 1.9, 1.9, 1.5];
  const colX = [0.5];
  for (let i = 1; i < 5; i++) colX.push(colX[i-1] + colW[i-1]);
  const rowH = 0.55;

  // Headers
  const headers = ["能力维度", "医院软件", "云厂商", "隐私计算公司", "我们"];
  headers.forEach((h, i) => {
    const isUs = i === 4;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: colX[i], y: tableY, w: colW[i], h: rowH,
      fill: { color: isUs ? theme.primary : theme.secondary }
    });
    slide.addText(h, {
      x: colX[i], y: tableY, w: colW[i], h: rowH,
      fontSize: 12, fontFace: "Microsoft YaHei",
      color: "FFFFFF", bold: true, align: "center", valign: "middle", margin: 0
    });
  });

  // Comparison rows
  const rows = [
    { dim: "可信空间", vals: ["-", "部分", "核心能力", "核心能力"] },
    { dim: "AI能力", vals: ["-", "强", "-", "核心能力"] },
    { dim: "模型平台", vals: ["-", "部分", "-", "核心能力"] },
    { dim: "科研协作", vals: ["部分", "-", "-", "核心能力"] },
    { dim: "Agent生态", vals: ["-", "部分", "-", "核心能力"] },
    { dim: "医院网络", vals: ["单院", "-", "有限", "多中心网络"] }
  ];

  rows.forEach((r, ri) => {
    const ry = tableY + (ri + 1) * rowH;
    const isEven = ri % 2 === 0;

    // Dimension column
    slide.addShape(pres.shapes.RECTANGLE, {
      x: colX[0], y: ry, w: colW[0], h: rowH,
      fill: { color: theme.light, transparency: isEven ? 40 : 60 }
    });
    slide.addText(r.dim, {
      x: colX[0], y: ry, w: colW[0], h: rowH,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
    });

    // Value columns
    r.vals.forEach((v, ci) => {
      const colIdx = ci + 1;
      const isUs = colIdx === 4;
      const hasCapability = v === "核心能力" || v === "强" || v === "多中心网络" || v === "部分" || v === "有限";
      const isStrong = v === "核心能力" || v === "强" || v === "多中心网络";

      slide.addShape(pres.shapes.RECTANGLE, {
        x: colX[colIdx], y: ry, w: colW[colIdx], h: rowH,
        fill: { color: isUs ? theme.accent : theme.light, transparency: isUs ? 70 : (isEven ? 60 : 75) }
      });

      if (isUs && isStrong) {
        // Checkmark for us
        slide.addText("✓ " + v, {
          x: colX[colIdx], y: ry, w: colW[colIdx], h: rowH,
          fontSize: 11, fontFace: "Microsoft YaHei",
          color: theme.primary, bold: true, align: "center", valign: "middle", margin: 0
        });
      } else if (v === "-") {
        slide.addText("—", {
          x: colX[colIdx], y: ry, w: colW[colIdx], h: rowH,
          fontSize: 12, fontFace: "Arial",
          color: theme.secondary, align: "center", valign: "middle", margin: 0
        });
      } else {
        slide.addText(v, {
          x: colX[colIdx], y: ry, w: colW[colIdx], h: rowH,
          fontSize: 11, fontFace: "Microsoft YaHei",
          color: theme.secondary, align: "center", valign: "middle", margin: 0
        });
      }
    });
  });

  // Bottom positioning statement
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.0, w: 9, h: 0.0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("12", {
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
  pres.writeFile({ fileName: "slide-12-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
