export default function DataTableRow({
  row,
  columns,
}) {
  return (
    <tr
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
          className="
            px-6
            py-5

            text-sm

            text-zinc-200
          "
        >
          {column.render
            ? column.render(row)
            : row[column.key]}
        </td>

      ))}

    </tr>
  );
}