export default function SpecTableBlock({ rows }: { rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="table-plain">
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.label}-${i}`}>
              <th scope="row" className="w-[38%] min-w-[9rem]">
                {row.label}
              </th>
              <td className="data">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
