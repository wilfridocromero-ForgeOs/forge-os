import { supabase } from "../../../lib/supabase";

function fail(error) { if (error) throw error; }
export async function listGrowthSystems() {
  const { data, error } = await supabase.from("growth_systems").select("id,name,objective,lifecycle,updated_at").order("updated_at", { ascending: false }); fail(error); return data || [];
}
export async function createGrowthSystem(name, objective) {
  const { data, error } = await supabase.rpc("create_growth_system", { system_name: name, system_objective: objective }); fail(error); return data;
}
export async function loadGrowthSystem(id) {
  const { data: system, error } = await supabase.from("growth_systems").select("*").eq("id", id).single(); fail(error);
  const { data: revision, error: revisionError } = await supabase.from("growth_system_revisions").select("*").eq("system_id", id).eq("state", "draft").single(); fail(revisionError);
  const [{ data: nodes, error: nodeError }, { data: edges, error: edgeError }] = await Promise.all([
    supabase.from("growth_system_nodes").select("*").eq("revision_id", revision.id).order("created_at"),
    supabase.from("growth_system_edges").select("*").eq("revision_id", revision.id).order("created_at"),
  ]); fail(nodeError); fail(edgeError); return { system, revision, nodes: nodes || [], edges: edges || [] };
}
export async function addGrowthNode(revision, node) {
  const payload = { organization_id: revision.organization_id, system_id: revision.system_id, revision_id: revision.id, node_type: node.node_type, label: node.label, position_x: node.position_x, position_y: node.position_y, configuration: node.configuration };
  const { data, error } = await supabase.from("growth_system_nodes").insert(payload).select().single(); fail(error); return data;
}
export async function updateGrowthNode(node, changes) { const { data, error } = await supabase.from("growth_system_nodes").update(changes).eq("id", node.id).eq("updated_at", node.updated_at).select().single(); fail(error); return data; }
export async function deleteGrowthNode(id) { const { error } = await supabase.from("growth_system_nodes").delete().eq("id", id); fail(error); }
export async function addGrowthEdge(revision, source, target) { const { data, error } = await supabase.from("growth_system_edges").insert({ organization_id: revision.organization_id, system_id: revision.system_id, revision_id: revision.id, source_node_id: source, target_node_id: target }).select().single(); fail(error); return data; }
export async function deleteGrowthEdge(id) { const { error } = await supabase.from("growth_system_edges").delete().eq("id", id); fail(error); }
export async function updateGrowthSystem(id, changes) { const { data, error } = await supabase.from("growth_systems").update(changes).eq("id", id).select().single(); fail(error); return data; }
