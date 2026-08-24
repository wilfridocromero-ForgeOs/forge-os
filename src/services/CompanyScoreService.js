import { supabase } from "../lib/supabase";

const COMPANY_SCORE_FIELDS = "id,organization_id,model_id,performance_percentage,master_score,coverage_percentage,status,calculated_at";
const DIVISION_SCORE_FIELDS = "id,organization_id,division_id,model_id,performance_percentage,coverage_percentage,status,calculated_at";

export async function getCompanyScoreDashboard(organizationId) {
  const { data: models, error: modelError } = await supabase
    .from("company_score_models")
    .select("id,name,version,status,minimum_publishable_coverage,stale_after_days,published_at")
    .eq("organization_id", organizationId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1);

  if (modelError) throw modelError;
  const model = models?.[0] || null;
  if (!model) return { model: null, snapshot: null, divisions: [] };

  const [snapshotResult, componentResult, divisionScoreResult] = await Promise.all([
    supabase.from("company_score_snapshots").select(COMPANY_SCORE_FIELDS)
      .eq("organization_id", organizationId).eq("model_id", model.id)
      .order("calculated_at", { ascending: false }).order("created_at", { ascending: false }).limit(2),
    supabase.from("company_score_components")
      .select("division_id,weight,created_at,divisions(id,name,active,position)")
      .eq("organization_id", organizationId).eq("model_id", model.id).eq("active", true),
    supabase.from("current_division_scores").select(DIVISION_SCORE_FIELDS)
      .eq("organization_id", organizationId),
  ]);

  if (snapshotResult.error) throw snapshotResult.error;
  if (componentResult.error) throw componentResult.error;
  if (divisionScoreResult.error) throw divisionScoreResult.error;

  const scoresByDivision = new Map((divisionScoreResult.data || []).map((score) => [score.division_id, score]));
  const divisions = (componentResult.data || []).map((component) => ({
    id: component.division_id,
    name: component.divisions?.name || "División",
    position: component.divisions?.position ?? Number.MAX_SAFE_INTEGER,
    weight: Number(component.weight),
    configuredAt: component.created_at,
    score: scoresByDivision.get(component.division_id) || null,
  })).sort((a, b) => b.weight - a.weight || a.position - b.position || a.configuredAt.localeCompare(b.configuredAt));

  const snapshots = snapshotResult.data || [];
  return { model, snapshot: snapshots[0] || null, previousSnapshot: snapshots[1] || null, divisions };
}
