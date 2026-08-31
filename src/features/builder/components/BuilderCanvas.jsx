import { useEffect } from "react";
import { Background, ReactFlow, useReactFlow, useViewport } from "@xyflow/react";
import { Focus, Minus, Plus } from "lucide-react";
import "@xyflow/react/dist/style.css";
import BuilderNode from "./BuilderNode";
import { formatBuilderZoom } from "../model/builderWorkspacePreferences";

const nodeTypes = { builder: BuilderNode };

function BuilderCanvasControls({ layoutKey }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();

  useEffect(() => {
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(frame);
  }, [layoutKey]);

  return <div className="builder-canvas-controls" role="group" aria-label="Controles de zoom del canvas">
    <button type="button" onClick={() => zoomOut({ duration: 180 })} aria-label="Alejar canvas"><Minus size={15}/></button>
    <output aria-label="Zoom actual">{formatBuilderZoom(zoom)}</output>
    <button type="button" onClick={() => zoomIn({ duration: 180 })} aria-label="Acercar canvas"><Plus size={15}/></button>
    <button type="button" className="builder-fit-control" onClick={() => fitView({ padding: 0.2, minZoom: 0.25, maxZoom: 1.1, duration: 240 })}><Focus size={14}/> Encajar</button>
  </div>;
}

export default function BuilderCanvas({ nodes, edges, onNodesChange, onConnect, onNodeClick, onEdgesDelete, layoutKey }) {
  return <div className="builder-canvas" aria-label="Canvas del sistema">
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      onEdgesDelete={onEdgesDelete}
      fitView
      fitViewOptions={{ padding: 0.2, minZoom: 0.25, maxZoom: 1.1 }}
      minZoom={0.25}
      maxZoom={1.5}
      deleteKeyCode={["Backspace", "Delete"]}
    >
      <Background gap={28} size={1} />
      <BuilderCanvasControls layoutKey={layoutKey}/>
    </ReactFlow>
  </div>;
}
