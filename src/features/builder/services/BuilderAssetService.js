import { supabase } from "../../../lib/supabase";

function fail(error) { if (error) throw error; }

export async function listBuilderAssets({ assetType = null, includeArchived = true } = {}) {
  let query = supabase
    .from("builder_assets")
    .select("id,organization_id,asset_type,name,lifecycle,created_by,created_at,updated_at,archived_at,builder_asset_versions(id,version_number,state,schema_version,created_at)")
    .order("updated_at", { ascending: false });
  if (assetType) query = query.eq("asset_type", assetType);
  if (!includeArchived) query = query.neq("lifecycle", "archived");
  const { data, error } = await query;
  fail(error);
  return data || [];
}

export async function createBuilderAsset(name, assetType, targetNodeId = null) {
  const { data: asset, error } = await supabase.rpc("create_builder_asset", {
    asset_name: name,
    requested_asset_type: assetType,
    target_node_id: targetNodeId,
  });
  fail(error);
  if (!targetNodeId) return { asset, node: null };
  const { data: node, error: nodeError } = await supabase.from("growth_system_nodes").select("*").eq("id", targetNodeId).single();
  fail(nodeError);
  return { asset, node };
}

export async function updateBuilderAsset(asset, changes) {
  const { data, error } = await supabase
    .from("builder_assets")
    .update(changes)
    .eq("id", asset.id)
    .eq("updated_at", asset.updated_at)
    .select()
    .single();
  fail(error);
  return data;
}

export async function loadBuilderAsset(id) {
  const { data: asset, error } = await supabase.from("builder_assets").select("*").eq("id", id).single();
  fail(error);
  const [{ data: versions, error: versionError }, { data: nodes, error: nodeError }] = await Promise.all([
    supabase.from("builder_asset_versions").select("id,version_number,state,schema_version,created_at").eq("asset_id", id).order("version_number", { ascending: false }),
    supabase.from("growth_system_nodes").select("id,label,node_type,system_id").eq("asset_id", id),
  ]);
  fail(versionError); fail(nodeError);
  const systemIds = [...new Set((nodes || []).map((node) => node.system_id))];
  let systems = [];
  if (systemIds.length) {
    const { data, error: systemError } = await supabase.from("growth_systems").select("id,name,lifecycle").in("id", systemIds);
    fail(systemError); systems = data || [];
  }
  const systemById = new Map(systems.map((system) => [system.id, system]));
  return { asset, versions: versions || [], usages: (nodes || []).map((node) => ({ ...node, system: systemById.get(node.system_id) || null })) };
}
