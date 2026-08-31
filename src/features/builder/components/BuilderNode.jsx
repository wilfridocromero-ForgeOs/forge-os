import { Handle, Position } from "@xyflow/react";
import { BUILDER_NODE_TYPES } from "../model/builderGraph";
import { getBuilderNodePresentation } from "../model/builderWorkspacePreferences";

export default function BuilderNode({ data, selected }) {
  const definition = BUILDER_NODE_TYPES[data.node_type];
  const presentation = getBuilderNodePresentation(data, definition);

  return <div className={`builder-node ${selected ? "is-selected" : ""}`} tabIndex={0} aria-label={`${definition.label}: ${data.label}`}>
    {definition.kind !== "source" && <Handle type="target" position={Position.Left} />}
    <span>{presentation.typeLabel}</span>
    {presentation.customLabel && <strong>{presentation.customLabel}</strong>}
    <small>{presentation.statusLabel}</small>
    {definition.kind !== "terminal" && <Handle type="source" position={Position.Right} />}
  </div>;
}
