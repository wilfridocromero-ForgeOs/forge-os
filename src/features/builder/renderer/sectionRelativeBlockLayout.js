export function hasSectionRelativeBlockLayout(block, section, breakpoint = "desktop") {
  const regions = section?.regions || [];
  const blockCount = regions.reduce((total, region) => total + (region.blocks?.length || 0), 0);
  if (regions.length !== 1 || blockCount !== 1 || regions[0]?.blocks?.[0]?.id !== block?.id) return false;
  const style = breakpoint === "desktop" ? block?.style : block?.responsive?.[breakpoint];
  return Boolean(style && (
    Object.prototype.hasOwnProperty.call(style, "align") ||
    Object.prototype.hasOwnProperty.call(style, "max_width")
  ));
}

export function calculateSectionRelativeGeometry({
  sectionWidth,
  sectionPaddingLeft = 0,
  sectionPaddingRight = 0,
  regionLeft,
  widthRatio = 1,
  maxWidth = Number.POSITIVE_INFINITY,
  align = "start",
}) {
  const usableLeft = sectionPaddingLeft;
  const usableWidth = sectionWidth - sectionPaddingLeft - sectionPaddingRight;
  const blockWidth = Math.min(usableWidth * widthRatio, maxWidth);
  const targetLeft = align === "center"
    ? usableLeft + (usableWidth - blockWidth) / 2
    : align === "end"
      ? usableLeft + usableWidth - blockWidth
      : usableLeft;
  return { usableLeft, usableWidth, blockWidth, targetLeft, offsetFromRegion: targetLeft - regionLeft };
}
