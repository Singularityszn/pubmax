import RouteLoadingShell from "@/components/nav/RouteLoadingShell";
import { socialSurfaceName } from "@/lib/socialLaunch";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

export default async function SocialLoading() {
  const friendsLaunchEnabled = readTrustedHandoffFlag("socialFriendsLaunch");
  return (
    <RouteLoadingShell label={socialSurfaceName(friendsLaunchEnabled)} />
  );
}
