import Link from "next/link";

import {
  AUTH_ACCOUNT_BANNED_MESSAGE,
  AUTH_ACCOUNT_BANNED_TERMS_PATH,
} from "@/lib/authAccountBan";

type AuthAccountBannedNoticeProps = {
  onDismiss?: () => void;
  className?: string;
};

export default function AuthAccountBannedNotice({
  onDismiss,
  className = "authCallbackNotice",
}: AuthAccountBannedNoticeProps): React.JSX.Element {
  return (
    <div className={className} role="alert">
      <span>
        {AUTH_ACCOUNT_BANNED_MESSAGE}{" "}
        <Link href={AUTH_ACCOUNT_BANNED_TERMS_PATH}>Community guidelines</Link>
      </span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
