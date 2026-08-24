import { useEffect, useState } from "react";

import { useAuth } from "../Context/AuthContext";
import { getDashboardData } from "../services/DashboardService";

export default function useDashboardData() {
  const { profile, user } = useAuth();
  const organizationId = profile?.organization_id;
  const userId = user?.id;
  const requestKey = organizationId && userId ? `${organizationId}:${userId}` : null;
  const [state, setState] = useState({ requestKey: null, data: null, error: null });

  useEffect(() => {
    let active = true;

    if (!organizationId || !userId) return undefined;
    getDashboardData({ organizationId, userId })
      .then((data) => active && setState({ requestKey, data, error: null }))
      .catch((error) => active && setState({ requestKey, data: null, error }));

    return () => {
      active = false;
    };
  }, [organizationId, requestKey, userId]);

  if (!requestKey) return { data: null, loading: false, error: null };
  if (state.requestKey !== requestKey) return { data: null, loading: true, error: null };
  return { data: state.data, loading: false, error: state.error };
}
