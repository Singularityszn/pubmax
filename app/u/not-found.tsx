import NotFound from "@/app/not-found";

import ProfileNotFoundClient from "./ProfileNotFoundClient";

export default function ProfileNotFound() {
  return <ProfileNotFoundClient fallback={<NotFound />} />;
}
