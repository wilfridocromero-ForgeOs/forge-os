import { useEffect, useState } from "react";

import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

function normalizeScore(row) {
  return {
    ...row,
    total_score: row.score,
    area_name: row.work_areas?.name,
    categories: row.breakdown?.categories || [],
    strengths: row.breakdown?.strengths || [],
    risks: row.breakdown?.risks || [],
  };
}

export default function useOrganizationScore(selectedAreaId = "") {
  const { profile, areaAccess, role } = useAuth();
  const organizationId = profile?.organization_id;
  const allowedAreaIds = areaAccess.map((item) => item.area_id);
  const allowedKey = allowedAreaIds.join(",");
  const [state, setState] = useState({ data: null, options: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    if (!organizationId || (role !== "platform_owner" && !allowedAreaIds.length)) {
      setState({ data: null, options: [], loading: false, error: null });
      return undefined;
    }

    setState((current) => ({ ...current, loading: true, error: null }));
    let query = supabase
      .from("area_scores")
      .select("id, area_id, score, max_score, status, breakdown, recommendations, computed_at, work_areas(name)")
      .eq("organization_id", organizationId)
      .order("computed_at", { ascending: false });

    if (role !== "platform_owner") query = query.in("area_id", allowedAreaIds);

    query.then(({ data, error }) => {
      if (!active) return;
      if (error) return setState({ data: null, options: [], loading: false, error });
      const seen = new Set();
      const options = (data || []).filter((row) => {
        if (seen.has(row.area_id)) return false;
        seen.add(row.area_id);
        return true;
      }).map(normalizeScore);
      const selected = options.find((row) => row.area_id === selectedAreaId) || options[0] || null;
      setState({ data: selected, options, loading: false, error: null });
    });

    return () => { active = false; };
  }, [organizationId, allowedKey, role, selectedAreaId]);

  return state;
}
