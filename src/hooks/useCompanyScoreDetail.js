import { useEffect, useState } from "react";
import { useAuth } from "../Context/AuthContext";
import { getCompanyScoreDetail } from "../services/CompanyScoreDetailService";

export default function useCompanyScoreDetail() {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;
  const [state, setState] = useState({ organizationId: null, data: null, error: null });

  useEffect(() => {
    let active = true;
    if (!organizationId) return undefined;
    getCompanyScoreDetail(organizationId)
      .then((data) => active && setState({ organizationId, data, error: null }))
      .catch((error) => active && setState({ organizationId, data: null, error }));
    return () => { active = false; };
  }, [organizationId]);

  if (!organizationId) return { data: null, loading: false, error: null };
  if (state.organizationId !== organizationId) return { data: null, loading: true, error: null };
  return { data: state.data, loading: false, error: state.error };
}
