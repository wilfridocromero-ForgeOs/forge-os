import { useEffect, useState } from "react";

import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

export default function useOrganizationScore() {
  const { profile, areaAccess } = useAuth();
  const organizationId = profile?.organization_id;
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let active = true;

    if (!organizationId) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }

    setState((current) => ({ ...current, loading: true, error: null }));

    supabase
      .from("area_scores")
      .select("id, area_id, score, max_score, status, breakdown, recommendations, computed_at, work_areas(name)")
      .eq("organization_id", organizationId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) return setState({ data: null, loading: false, error });
        setState({
          data: data ? {
            ...data,
            total_score: data.score,
            area_name: data.work_areas?.name,
            categories: data.breakdown?.categories || [],
            strengths: data.breakdown?.strengths || [],
            risks: data.breakdown?.risks || [],
          } : null,
          loading: false,
          error: null,
        });
      });

    return () => {
      active = false;
    };
  }, [organizationId, areaAccess]);

  return state;
}
