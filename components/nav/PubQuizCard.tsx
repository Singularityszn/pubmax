// A pub quiz question on a loading screen. Something to read while a route
// arrives, never a game: no score, no streak, no level (docs/VOICE.md,
// "Template patterns"). The answer sits behind a native <details>, so the card
// adds no JavaScript to the held frame, and every word of the answer comes from
// the Historic England entry it links to (lib/pubQuiz.ts).

import type { PubQuizQuestion } from "@/lib/pubQuiz";

export default function PubQuizCard({ quiz }: { quiz: PubQuizQuestion }) {
  return (
    <section className="pubQuizCard" aria-labelledby="pub-quiz-heading">
      <h2 id="pub-quiz-heading" className="pubQuizCardHeading">Pub quiz while you wait</h2>
      <p className="pubQuizCardQuestion">{quiz.question}</p>
      <ul className="pubQuizCardOptions">
        {quiz.options.map((option) => (
          <li key={option}>{option}</li>
        ))}
      </ul>
      <details className="pubQuizCardAnswer">
        <summary>Show the answer</summary>
        <p>
          {quiz.answer}.{quiz.detail ? ` ${quiz.detail}` : ""}
        </p>
        <p className="pubQuizCardSource">
          <a href={quiz.sourceUrl} target="_blank" rel="noopener noreferrer">
            Historic England list entry
          </a>
        </p>
      </details>
    </section>
  );
}
