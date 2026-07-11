const pptxgen = require("pptxgenjs");

const slideConfig = {
  type: 'content',
  index: 14,
  title: '三年规划'
};

function createSlide(pres, theme) {
  const slide = pres.addSlide();
  slide.background = { color: theme.bg };

  // Title
  slide.addText("三年规划", {
    x: 0.5, y: 0.35, w: 9, h: 0.6,
    fontSize: 32, fontFace: "Microsoft YaHei",
    color: theme.primary, bold: true, align: "left", margin: 0
  });

  // Subtitle
  slide.addText("Roadmap — 形成全国医疗AI基础设施", {
    x: 0.5, y: 0.92, w: 9, h: 0.35,
    fontSize: 13, fontFace: "Georgia",
    color: theme.secondary, italic: true, align: "left", margin: 0
  });

  // Timeline (horizontal, 3 phases)
  const timelineY = 2.3;
  const timelineStartX = 0.8;
  const timelineEndX = 9.2;
  const timelineW = timelineEndX - timelineStartX;

  // Timeline base line
  slide.addShape(pres.shapes.RECTANGLE, {
    x: timelineStartX, y: timelineY, w: timelineW, h: 0.06,
    fill: { color: theme.accent, transparency: 40 }
  });

  // Phases
  const phases = [
    {
      year: "2026",
      title: "可信空间",
      desc: "完成核心平台搭建\n首批医院接入\n验证数据流通闭环",
      color: theme.secondary,
      progress: "Phase 1"
    },
    {
      year: "2027",
      title: "医疗AI平台",
      desc: "AI能力层全面上线\n模型训练与Agent\n规模化医院拓展",
      color: theme.accent,
      progress: "Phase 2"
    },
    {
      year: "2028",
      title: "全国协作网络",
      desc: "全国医疗数据协作\n平台生态形成\n行业基础设施定位",
      color: theme.primary,
      progress: "Phase 3"
    }
  ];

  const phaseGap = timelineW / 3;

  phases.forEach((p, i) => {
    const px = timelineStartX + phaseGap * i + phaseGap / 2;
    const cardW = 2.6, cardH = 2.0;

    // Timeline node (circle)
    slide.addShape(pres.shapes.OVAL, {
      x: px - 0.15, y: timelineY - 0.12, w: 0.3, h: 0.3,
      fill: { color: p.color },
      line: { color: "FFFFFF", width: 2 }
    });
    slide.addText(String(i + 1), {
      x: px - 0.15, y: timelineY - 0.12, w: 0.3, h: 0.3,
      fontSize: 11, fontFace: "Georgia",
      color: "FFFFFF", bold: true, align: "center", valign: "middle"
    });

    // Year label (above timeline)
    slide.addText(p.year, {
      x: px - 0.6, y: timelineY - 0.55, w: 1.2, h: 0.35,
      fontSize: 18, fontFace: "Georgia",
      color: p.color, bold: true, align: "center", margin: 0
    });

    // Card (below timeline)
    const cardX = px - cardW / 2;
    const cardY = timelineY + 0.35;
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cardX, y: cardY, w: cardW, h: cardH,
      fill: { color: theme.light, transparency: 55 },
      line: { color: p.color, width: 1.5 }
    });

    // Phase tag
    slide.addText(p.progress, {
      x: cardX + 0.15, y: cardY + 0.1, w: cardW - 0.3, h: 0.25,
      fontSize: 10, fontFace: "Georgia",
      color: p.color, italic: true, align: "left", margin: 0
    });

    // Title
    slide.addText(p.title, {
      x: cardX + 0.15, y: cardY + 0.35, w: cardW - 0.3, h: 0.35,
      fontSize: 16, fontFace: "Microsoft YaHei",
      color: theme.primary, bold: true, align: "left", margin: 0
    });

    // Divider
    slide.addShape(pres.shapes.RECTANGLE, {
      x: cardX + 0.15, y: cardY + 0.72, w: cardW - 0.3, h: 0.02,
      fill: { color: p.color, transparency: 50 }
    });

    // Description
    slide.addText(p.desc, {
      x: cardX + 0.15, y: cardY + 0.82, w: cardW - 0.3, h: 1.0,
      fontSize: 11, fontFace: "Microsoft YaHei",
      color: theme.secondary, align: "left", valign: "top",
      lineSpacingMultiple: 1.3, margin: 0
    });
  });

  // Bottom vision
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 5.05, w: 0, h: 0
  });

  // Page badge
  slide.addShape(pres.shapes.OVAL, {
    x: 9.3, y: 5.1, w: 0.4, h: 0.4,
    fill: { color: theme.accent }
  });
  slide.addText("14", {
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
  pres.writeFile({ fileName: "slide-14-preview.pptx" });
}

module.exports = { createSlide, slideConfig };
