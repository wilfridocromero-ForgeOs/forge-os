import test from "node:test";
import assert from "node:assert/strict";
import { createsCycle, validateBuilderGraph } from "./builderGraph.js";
const node = (id, node_type) => ({ id, node_type, label: id, configuration: { config_version: 1 } });
const validNodes = [node("a", "traffic_source"), node("b", "landing_page"), node("c", "form"), node("d", "lead_handoff")];
const validEdges = [
  { id: "1", source_node_id: "a", target_node_id: "b" }, { id: "2", source_node_id: "b", target_node_id: "c" }, { id: "3", source_node_id: "c", target_node_id: "d" },
];
test("accepts a valid acquisition graph", () => assert.equal(validateBuilderGraph(validNodes, validEdges).valid, true));
test("reports missing source and orphan nodes", () => {
  const result = validateBuilderGraph(validNodes.slice(1), validEdges.slice(1));
  assert.ok(result.errors.some((error) => error.code === "missing_source"));
  assert.ok(result.errors.some((error) => error.code === "orphan"));
});
test("rejects self, duplicate and cyclic edges", () => {
  assert.equal(createsCycle(validEdges, "d", "a"), true);
  const result = validateBuilderGraph(validNodes, [...validEdges, { id: "4", source_node_id: "a", target_node_id: "a" }, { id: "5", source_node_id: "a", target_node_id: "b" }]);
  assert.ok(result.errors.some((error) => error.code === "self_edge"));
  assert.ok(result.errors.some((error) => error.code === "duplicate_edge"));
});
test("rejects invalid semantic relationships", () => assert.ok(validateBuilderGraph(validNodes, [{ id: "x", source_node_id: "a", target_node_id: "c" }]).errors.some((error) => error.code === "invalid_relationship")));
