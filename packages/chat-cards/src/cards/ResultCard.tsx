import type { ResultCardMessage } from '../types';

export interface ResultCardProps {
  card: ResultCardMessage;
  className?: string;
}

export function ResultCard({ card, className }: ResultCardProps) {
  const rows = card.data ? Object.entries(card.data) : [];
  return (
    <section
      className={className ?? 'rounded-lg border border-slate-200 bg-white p-4'}
      data-card-type="result"
      data-card-title={card.title}
    >
      <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
      {card.description ? (
        <p className="mt-1 text-sm text-slate-500">{card.description}</p>
      ) : null}
      {rows.length > 0 ? (
        <table className="mt-3 w-full text-left text-sm">
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key} className="border-t border-slate-100">
                <th scope="row" className="py-1 pr-3 font-medium text-slate-500">
                  {key}
                </th>
                <td className="py-1 text-slate-900" data-result-key={key}>
                  {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
