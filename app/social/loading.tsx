import RouteLoadingShell from "@/components/nav/RouteLoadingShell";
import { loadingPubQuizQuestion } from "@/lib/pubQuiz.server";
import { isSocialFriendsLaunchEnabled, SOCIAL_FRIENDS_LAUNCH_ENV, socialSurfaceName } from "@/lib/socialLaunch";

export default function SocialLoading() {
  const friendsLaunchEnabled = isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV]);
  return (
    <RouteLoadingShell
      label={socialSurfaceName(friendsLaunchEnabled)}
      quiz={loadingPubQuizQuestion()}
    />
  );
}
