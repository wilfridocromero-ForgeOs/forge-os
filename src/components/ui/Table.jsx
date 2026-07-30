export default function Table({
  columns = [],
  data = [],
  emptyMessage = "No hay información disponible.",
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#111113]">

      <div className="overflow-x-auto">

        <table className="w-full">

          <thead className="border-b border-zinc-800 bg-zinc-900/40">

            <tr>

              {columns.map((column) => (

                <th
                  key={column.key}
                  className="
                    px-6
                    py-4
                    text-left
                    text-xs
                    font-semibold
                    uppercase
                    tracking-wider
                    text-zinc-500
                  "
                >
                  {column.label}
                </th>

              ))}

            </tr>

          </thead>

          <tbody>

            {data.length === 0 ? (

              <tr>

                <td
                  colSpan={columns.length}
                  className="px-6 py-12 text-center text-zinc-500"
                >
                  {emptyMessage}
                </td>

              </tr>

            ) : (

              data.map((row, index) => (

                <tr
                  key={index}
                  className="
                    border-b
                    border-zinc-800
                    transition-colors
                    hover:bg-zinc-900/40
                  "
                >

                  {columns.map((column) => (

                    <td
                      key={column.key}
                      className="px-6 py-5 text-sm text-zinc-300"
                    >
                      {row[column.key]}
                    </td>

                  ))}

                </tr>

              ))

            )}

          </tbody>

        </table>

      </div>

    </div>
  );
}