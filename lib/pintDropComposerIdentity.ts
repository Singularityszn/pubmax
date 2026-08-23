/**
 * Choose the handle shown and sent by the Pint Drop composer.
 *
 * An account handle is the authority-bearing value. A browser draft remains
 * available only for the keyless demo path, where no account identity exists.
 */
export function pintDropAuthorValue(input: {
  accountHandle: string | null | undefined;
  draftHandle: string;
}): { handle: string; accountOwned: boolean } {
  const accountHandle = input.accountHandle?.trim() ?? "";
  if (accountHandle) {
    return { handle: accountHandle, accountOwned: true };
  }

  return { handle: input.draftHandle, accountOwned: false };
}
