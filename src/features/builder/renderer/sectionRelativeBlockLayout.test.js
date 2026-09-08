import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateSectionRelativeGeometry, hasSectionRelativeBlockLayout } from "./sectionRelativeBlockLayout.js";

test("only explicit width or position opts a block into section-relative layout", () => {
  const standalone = (block) => ({ regions: [{ blocks: [block] }] });
  const heading = { id: "heading", type: "heading" };
  assert.equal(hasSectionRelativeBlockLayout(heading, standalone(heading)), false);
  const spacing = { id: "spacing", style: { padding_top: "sm" } };
  assert.equal(hasSectionRelativeBlockLayout(spacing, standalone(spacing)), false);
  const aligned = { id: "aligned", style: { align: "start" } };
  assert.equal(hasSectionRelativeBlockLayout(aligned, standalone(aligned)), true);
  const sized = { id: "sized", style: { max_width: "standard" } };
  assert.equal(hasSectionRelativeBlockLayout(sized, standalone(sized)), true);
  const responsive = { id: "responsive", responsive: { mobile: { align: "center" } } };
  assert.equal(hasSectionRelativeBlockLayout(responsive, standalone(responsive), "mobile"), true);
});

test("children of a group remain local even when they declare width or alignment", () => {
  const heading = { id: "heading", style: { align: "center", max_width: "standard" } };
  const text = { id: "text", style: { align: "center" } };
  const video = { id: "video", style: { align: "end", max_width: "wide" }, responsive: { mobile: { align: "center" } } };
  const group = { regions: [{ blocks: [heading, text] }, { blocks: [video] }] };
  for (const block of [heading, text, video]) assert.equal(hasSectionRelativeBlockLayout(block, group), false);
  assert.equal(hasSectionRelativeBlockLayout(video, group, "mobile"), false);
  assert.deepEqual(group.regions.flatMap((region) => region.blocks), [heading, text, video]);
});

test("75 percent blocks align to section usable width despite a partial region", () => {
  const input = { sectionWidth: 1000, sectionPaddingLeft: 40, sectionPaddingRight: 40, regionLeft: 510, widthRatio: 0.75, maxWidth: 832 };
  const start = calculateSectionRelativeGeometry({ ...input, align: "start" });
  const center = calculateSectionRelativeGeometry({ ...input, align: "center" });
  const end = calculateSectionRelativeGeometry({ ...input, align: "end" });
  assert.equal(center.usableWidth, 920);
  assert.equal(center.blockWidth, 690);
  assert.equal(start.targetLeft, 40);
  assert.equal(center.targetLeft, 155);
  assert.equal(end.targetLeft, 270);
  assert.equal(center.targetLeft + center.blockWidth / 2, 500);
  const otherRegion = calculateSectionRelativeGeometry({ ...input, regionLeft: 40, align: "center" });
  assert.equal(otherRegion.targetLeft, center.targetLeft);
  assert.equal(otherRegion.blockWidth, center.blockWidth);
});

test("full width has no artificial center offset", () => {
  const geometry = calculateSectionRelativeGeometry({ sectionWidth: 1000, sectionPaddingLeft: 40, sectionPaddingRight: 40, regionLeft: 510, widthRatio: 1, align: "center" });
  assert.equal(geometry.blockWidth, 920);
  assert.equal(geometry.targetLeft, 40);
});

test("editor gutters change the section origin but not its internal centering math", () => {
  const geometry = calculateSectionRelativeGeometry({ sectionWidth: 760, sectionPaddingLeft: 24, sectionPaddingRight: 24, regionLeft: 390, widthRatio: 0.75, align: "center" });
  assert.equal(geometry.usableWidth, 712);
  assert.equal(geometry.blockWidth, 534);
  assert.equal(geometry.targetLeft + geometry.blockWidth / 2, 380);
});

test("renderer wires measured section geometry without moving natural Pattern blocks", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../editor/BuilderInteractionV6.css", import.meta.url), "utf8");
  assert.match(source, /new ResizeObserver\(syncSectionGeometry\)/);
  assert.match(source, /data-section-relative=\{hasSectionRelativeBlockLayout\(block, section\)/);
  assert.match(source, /--lp-section-center-offset/);
  assert.match(styles, /\[data-section-relative=true\]\[data-block-align=center\]/);
  assert.match(styles, /left:var\(--lp-section-center-offset\);translate:-50% 0/);
  assert.doesNotMatch(styles, /\.landing-editor-block-wrap\[data-section-relative/);
});
