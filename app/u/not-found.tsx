import NotFound from "@/app/not-found";

import UnclaimedProfile from "./UnclaimedProfile";

export default function ProfileNotFound() {
  return <UnclaimedProfile fallback={<NotFound />} />;
}
