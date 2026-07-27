import Link from "next/link";

import type { LeagueRow } from "@/lib/pintIndex";
import { formatPrice } from "@/lib/venues";

/**
 * The borough league table, shared by the live Index and every dated edition
 * so a reader comparing this month with last month is reading one layout and
 * one set of rules, not two that drifted apart.
 */
export default function PintIndexLeagueTable({ rows, caption }: { rows: LeagueRow[]; caption: string }) {
  return (
    <div className="pintIndexTableWrap">
      <table className="pintIndexTable">
        <caption className="srOnly">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="pintIndexNum">#</th>
            <th scope="col">Borough</th>
            <th scope="col" className="pintIndexNum">Average</th>
            <th scope="col" className="pintIndexNum">Cheapest</th>
            <th scope="col" className="pintIndexNum">Dearest</th>
            <th scope="col" className="pintIndexNum">Eligible pubs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.slug}>
              <td className="pintIndexNum pintIndexRank">{index + 1}</td>
              <th scope="row">
                <Link href={`/borough/${row.slug}`} className="pintIndexBoroughLink">{row.name}</Link>
              </th>
              <td className="pintIndexNum pintIndexAvg">{formatPrice(row.averageGbp)}</td>
              <td className="pintIndexNum">{formatPrice(row.minGbp)}</td>
              <td className="pintIndexNum">{formatPrice(row.maxGbp)}</td>
              <td className="pintIndexNum">{row.pubCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
