export default function DataTableHeader({
  columns,
}) {
  return (
    <thead>

      <tr className="border-b border-zinc-800">

        {columns.map((column) => (

          <th
            key={column.key}
            className="
              px-6
              py-5

              text-left

              text-xs
              font-semibold

              uppercase
              tracking-[0.30em]

              text-zinc-500
            "
          >
            {column.title}
          </th>

        ))}

      </tr>

    </thead>
  );
}