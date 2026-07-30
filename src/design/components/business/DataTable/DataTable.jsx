import Card from "../../display/Card";

import DataTableHeader from "./DataTableHeader";
import DataTableRow from "./DataTableRow";
import DataTableEmpty from "./DataTableEmpty";

export default function DataTable({
  columns = [],
  data = [],
  emptyMessage = "No hay datos disponibles.",
}) {
  return (
    <Card padding="none">

      <div className="overflow-x-auto">

        <table className="min-w-full border-collapse">

          <DataTableHeader columns={columns} />

          <tbody>

            {data.length === 0 ? (
              <DataTableEmpty
                columns={columns}
                message={emptyMessage}
              />
            ) : (
              data.map((row, index) => (
                <DataTableRow
                  key={index}
                  row={row}
                  columns={columns}
                />
              ))
            )}

          </tbody>

        </table>

      </div>

    </Card>
  );
}