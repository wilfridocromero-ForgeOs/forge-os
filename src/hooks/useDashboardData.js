import { useEffect, useState } from "react";

import { useAuth } from "../Context/AuthContext";
import { getDashboardData } from "../services/DashboardService";

export default function useDashboardData() {
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
    getDashboardData(organizationId)
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error) => active && setState({ data: null, loading: false, error }));

    return () => {
      active = false;
    };
  }, [organizationId]);

  return state;
}
