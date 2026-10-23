import type { FriendInvite } from '@recollect/contracts';

export const friendInviteOrigin = 'https://recollect-ai.netlify.app';
const validCode = /^[A-Za-z0-9_-]{16,256}$/;

/** Accept the shared web link, older app links, or a pasted code. */
export function invitationCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes('://')) return validCode.test(trimmed) ? trimmed : '';
  try {
    const url = new URL(trimmed);
    const isWebInvite =
      url.origin === friendInviteOrigin && /^\/friends\/?$/.test(url.pathname);
    const isAppInvite =
      url.protocol === 'cognitioncurator:' &&
      (url.hostname === 'friends' || (!url.hostname && url.pathname === '/friends'));
    if (!isWebInvite && !isAppInvite) return '';
    const codes = url.searchParams.getAll('invite');
    const code = codes.length === 1 ? codes[0]!.trim() : '';
    return validCode.test(code) ? code : '';
  } catch {
    return '';
  }
}

export function friendInviteUrl(code: string): string {
  if (!validCode.test(code)) throw new Error('This friend invite code is invalid.');
  return friendInviteOrigin + '/friends?invite=' + encodeURIComponent(code);
}

export function friendInviteMessage(invite: FriendInvite): string {
  return (
    'Join me on Recollect to share decks and learn together.\n' +
    friendInviteUrl(invite.code) +
    '\n\nOpen the link to get Recollect or continue in the app. After installing, return to the link, or paste this one-use code in You → Friends: ' +
    invite.code +
    '\nThe invite expires in 7 days.'
  );
}
