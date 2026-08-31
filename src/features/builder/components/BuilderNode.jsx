import { Handle, Position } from "@xyflow/react";
import { BUILDER_NODE_TYPES } from "../model/builderGraph";
export default function BuilderNode({ data, selected }) {
  const definition = BUILDER_NODE_TYPES[data.node_type];
  return <div className={`builder-node ${selected ? "is-selected" : ""}`} tabIndex={0} aria-label={`${definition.label}: ${data.label}`}>
    {definition.kind !== "source" && <Handle type="target" position={Position.Left} />}
    <span>{definition.label}</span><strong>{data.label}</strong>
    {(data.node_type === "landing_page" || data.node_type === "form") && <small>Activo aún no configurado</small>}
    {definition.kind !== "terminal" && <Handle type="source" position={Position.Right} />}
  </div>;
}
