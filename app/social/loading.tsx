import RouteLoadingShell from "@/components/nav/RouteLoadingShell";
import { loadingPubQuizQuestion } from "@/lib/pubQuiz.server";
import { socialSurfaceName } from "@/lib/socialLaunch";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

export default function SocialLoading() {
  const friendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
  return (
    <RouteLoadingShell
      label={socialSurfaceName(friendsLaunchEnabled)}
      quiz={loadingPubQuizQuestion()}
    />
  );
}
