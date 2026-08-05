import { useEffect, useState } from "react";
import { getDivisions } from "../services/DivisionService";

export function useDivisions(organizationId) {
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getDivisions(organizationId)
      .then((rows) => active && setDivisions(rows))
      .catch((reason) => active && setError(reason.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [organizationId]);

  return { divisions, loading, error };
}
