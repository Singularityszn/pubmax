import RouteLoadingShell from "@/components/nav/RouteLoadingShell";
import { loadingPubQuizQuestion } from "@/lib/pubQuiz.server";

export default function FeedLoading() {
  return <RouteLoadingShell label="Stories" quiz={loadingPubQuizQuestion()} />;
}
