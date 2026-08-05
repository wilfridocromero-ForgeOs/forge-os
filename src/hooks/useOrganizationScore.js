import { useEffect, useState } from "react";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

function normalizeScore(row) {
  return {
    ...row,
    area_id: row.division_id,
    total_score: Number(row.current_score),
    area_name: row.divisions?.name,
    categories: row.breakdown?.categories || [],
    strengths: row.breakdown?.strengths || [],
    risks: row.breakdown?.risks || [],
    recommendations: row.breakdown?.recommendations || [],
  };
}

export default function useOrganizationScore(selectedDivisionId = "") {
  const { profile, role, user } = useAuth();
  const organizationId = profile?.organization_id;
  const [state, setState] = useState({ data: null, options: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    if (!organizationId || !user?.id) return undefined;
    async function load() {
      setState((current) => ({ ...current, loading: true, error: null }));
      let allowedIds = [];
      if (role !== "platform_owner" && role !== "organization_admin") {
        const access = await supabase.from("user_division_score_access").select("division_id").eq("user_id", user.id);
        if (access.error) return active && setState({ data: null, options: [], loading: false, error: access.error });
        allowedIds = (access.data || []).map((item) => item.division_id);
        if (!allowedIds.length) return active && setState({ data: null, options: [], loading: false, error: null });
      }
      let query = supabase.from("score_instances").select("id, division_id, current_score, max_score, percentage, status, breakdown, computed_at, divisions(name)").eq("organization_id", organizationId).order("computed_at", { ascending: false, nullsFirst: false });
      if (allowedIds.length) query = query.in("division_id", allowedIds);
      const { data, error } = await query;
      if (!active) return;
      if (error) return setState({ data: null, options: [], loading: false, error });
      const options = (data || []).map(normalizeScore);
      const selected = options.find((row) => row.division_id === selectedDivisionId) || options[0] || null;
      setState({ data: selected, options, loading: false, error: null });
    }
    load();
    return () => { active = false; };
  }, [organizationId, role, selectedDivisionId, user?.id]);
  return state;
}
