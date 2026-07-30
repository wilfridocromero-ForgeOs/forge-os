import ClientHeader from "./ClientHeader";
import ClientFilters from "./ClientFilters";
import ClientTable from "./ClientTable";
import ClientEmptyState from "./ClientEmptyState";

import { clients } from "../data/clients";

export default function ClientsView() {
  return (
    <div className="space-y-8">
      <ClientHeader />

      <ClientFilters />

      {clients.length > 0 ? (
        <ClientTable />
      ) : (
        <ClientEmptyState />
      )}
    </div>
  );
}