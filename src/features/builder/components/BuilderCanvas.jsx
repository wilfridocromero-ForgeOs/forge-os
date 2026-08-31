import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import BuilderNode from "./BuilderNode";
const nodeTypes = { builder: BuilderNode };
export default function BuilderCanvas({ nodes, edges, onNodesChange, onConnect, onNodeClick, onEdgesDelete }) {
  return <div className="builder-canvas" aria-label="Canvas del sistema">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onConnect={onConnect} onNodeClick={(_, node) => onNodeClick(node.id)} onEdgesDelete={onEdgesDelete} fitView minZoom={0.35} maxZoom={1.8} deleteKeyCode={["Backspace", "Delete"]}>
      <Background gap={28} size={1} /><Controls showInteractive={false} aria-label="Controles del canvas" />
    </ReactFlow>
  </div>;
}
