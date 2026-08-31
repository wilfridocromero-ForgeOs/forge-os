export const BUILDER_NODE_TYPES = Object.freeze({
  traffic_source: { label: "Fuente de tráfico", kind: "source", defaultLabel: "Fuente de tráfico" },
  landing_page: { label: "Landing Page", kind: "step", defaultLabel: "Landing Page" },
  form: { label: "Formulario", kind: "step", defaultLabel: "Formulario" },
  lead_handoff: { label: "Entrega de lead", kind: "terminal", defaultLabel: "Entrega de lead" },
});

export function createsCycle(edges, source, target) {
  if (source === target) return true;
  const next = new Map();
  for (const edge of edges) next.set(edge.source_node_id, [...(next.get(edge.source_node_id) || []), edge.target_node_id]);
  const pending = [target];
  const visited = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === source) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...(next.get(id) || []));
  }
  return false;
}

export function validateBuilderGraph(nodes, edges) {
  const errors = [];
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, 0]));
  const logical = new Set();
  const allowedTargets = { traffic_source: ["landing_page"], landing_page: ["form"], form: ["lead_handoff"], lead_handoff: [] };
  for (const edge of edges) {
    if (edge.source_node_id === edge.target_node_id) errors.push({ code: "self_edge", message: "Un paso no puede conectarse consigo mismo." });
    if (!ids.has(edge.source_node_id) || !ids.has(edge.target_node_id)) errors.push({ code: "invalid_edge", message: "Hay una conexión con pasos inexistentes." });
    const sourceNode = nodes.find((node) => node.id === edge.source_node_id); const targetNode = nodes.find((node) => node.id === edge.target_node_id);
    if (sourceNode && targetNode && !allowedTargets[sourceNode.node_type]?.includes(targetNode.node_type)) errors.push({ code: "invalid_relationship", message: "Una conexión no respeta Fuente → Landing → Formulario → Entrega." });
    const key = `${edge.source_node_id}:${edge.target_node_id}`;
    if (logical.has(key)) errors.push({ code: "duplicate_edge", message: "Hay una conexión duplicada." });
    logical.add(key);
    incoming.set(edge.target_node_id, (incoming.get(edge.target_node_id) || 0) + 1);
    outgoing.set(edge.source_node_id, (outgoing.get(edge.source_node_id) || 0) + 1);
  }
  if (!nodes.some((node) => node.node_type === "traffic_source")) errors.push({ code: "missing_source", message: "Añade al menos una fuente de tráfico." });
  if (!nodes.some((node) => node.node_type === "lead_handoff")) errors.push({ code: "missing_terminal", message: "Añade una entrega de lead." });
  for (const node of nodes) {
    if (node.node_type !== "traffic_source" && !incoming.get(node.id)) errors.push({ code: "orphan", nodeId: node.id, message: `${node.label} necesita una entrada.` });
    if (node.node_type !== "lead_handoff" && !outgoing.get(node.id)) errors.push({ code: "orphan", nodeId: node.id, message: `${node.label} necesita una salida.` });
    if (!BUILDER_NODE_TYPES[node.node_type] || node.configuration?.config_version !== 1) errors.push({ code: "invalid_config", nodeId: node.id, message: `${node.label} tiene una configuración inválida.` });
  }
  for (const edge of edges) if (createsCycle(edges.filter((item) => item.id !== edge.id), edge.source_node_id, edge.target_node_id)) errors.push({ code: "cycle", message: "El flujo no puede contener ciclos." });
  return { valid: errors.length === 0, errors };
}
