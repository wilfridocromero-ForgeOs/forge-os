import {
createContext,
useContext,
useEffect,
useState
} from "react";


import { useAuth } from "../Context/AuthContext";

import {
getUserOrganization
} from "../services/OrganizationService";


import {
getDashboardData
} from "../services/DashboardService";


const DashboardContext =
createContext();



export function DashboardProvider({
children
}) {


const { user } = useAuth();


const [
dashboard,
setDashboard
] = useState(null);



useEffect(()=>{


async function load(){


if(!user) return;



const organization =
await getUserOrganization(
user.id
);



const metrics =
await getDashboardData(
{
organizationId: organization.id,
userId: user.id
}
);



setDashboard({

organization,

metrics

});


}


load();


},[user]);



return (

<DashboardContext.Provider
value={{
dashboard
}}
>

{children}

</DashboardContext.Provider>

);

}



// Legacy provider kept compatible with the current dashboard service.
// eslint-disable-next-line react-refresh/only-export-components
export function useDashboard(){

return useContext(
DashboardContext
);

}
