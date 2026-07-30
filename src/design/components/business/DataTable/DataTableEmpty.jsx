export default function DataTableEmpty({
  columns,
  message,
}) {
  return (
    <tr>

      <td
        colSpan={columns.length}
        className="
          px-6
          py-16

          text-center

          text-sm

          text-zinc-500
        "
      >
        {message}
      </td>

    </tr>
  );
}