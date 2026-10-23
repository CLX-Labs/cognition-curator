import { describe, expect, it } from 'vitest';
import { friendInviteMessage, friendInviteUrl, invitationCode } from '../src/friend-invite';

const code = 'one_use-invite_0123456789abcdefXYZ';

describe('friend invitation links', () => {
  it('shares an install-safe HTTPS page and preserves a manual installation fallback', () => {
    const link = friendInviteUrl(code);
    expect(link).toBe('https://recollect-ai.netlify.app/friends?invite=' + code);
    expect(invitationCode(link)).toBe(code);
    const message = friendInviteMessage({ code, expiresAt: '2026-10-30T00:00:00Z' });
    expect(message).toContain(link);
    expect(message).toContain('After installing, return to the link');
    expect(message).toContain('You → Friends: ' + code);
    expect(message).not.toContain('cognitioncurator://');
  });

  it.each([
    code,
    '  ' + code + '  ',
    'cognitioncurator://friends?invite=' + code,
    'cognitioncurator:///friends?invite=' + code,
    'https://recollect-ai.netlify.app/friends/?invite=' + code,
  ])('accepts a code or supported invite link: %s', (value) => {
    expect(invitationCode(value)).toBe(code);
  });

  it.each([
    '',
    'too-short',
    'a'.repeat(257),
    'https://attacker.example/friends?invite=' + code,
    'https://recollect-ai.netlify.app/elsewhere?invite=' + code,
    'https://recollect-ai.netlify.app/friends?invite=' + code + '&invite=another_valid_code',
    'https://recollect-ai.netlify.app/friends?invite=%3Cscript%3E',
    'cognitioncurator://review?invite=' + code,
    'javascript://friends?invite=' + code,
  ])('rejects malformed and ambiguous invitations: %s', (value) => {
    expect(invitationCode(value)).toBe('');
  });
});
