import { useEffect, useState } from "react";

import { useAuth } from "../Context/AuthContext";
import { getScores } from "../services/ScoreService";

export default function useOrganizationScore() {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let active = true;

    if (!organizationId) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }

    setState((current) => ({ ...current, loading: true, error: null }));

    getScores(organizationId)
      .then((scores) => {
        if (!active) return;
        const sorted = [...scores].sort((a, b) => {
          const aDate = new Date(a.updated_at || a.created_at || 0).getTime();
          const bDate = new Date(b.updated_at || b.created_at || 0).getTime();
          return bDate - aDate;
        });
        setState({ data: sorted[0] ?? null, loading: false, error: null });
      })
      .catch((error) => {
        if (!active) return;
        setState({ data: null, loading: false, error });
      });

    return () => {
      active = false;
    };
  }, [organizationId]);

  return state;
}
