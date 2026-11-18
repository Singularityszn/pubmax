export default function PubRankingPlaceholder() {
  return <section className="pubRanking">
    <h2>Your pubs, ranked</h2>
    <div className="pubRanking__switch">
      <button type="button" disabled>Yours</button>
      <button type="button" disabled>Your lot&rsquo;s</button>
    </div>
    <p className="pubRanking__empty">Compare the pubs you have visited.</p>
  </section>;
}
