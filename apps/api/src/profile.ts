import { profileSchema, profileUpdateSchema, type Profile } from '@recollect/contracts';
import { DomainError, type Database } from '@recollect/db';

export class ProfileService {
  constructor(private db: Database) {}

  async get(ownerId: string): Promise<Profile> {
    const result = await this.db.query<Profile>(
      'SELECT id,name,profile_photo_data_url AS "photoDataUrl" FROM recollect.users WHERE id=$1 AND is_active=true',
      [ownerId],
    );
    if (!result.rows[0]) throw new DomainError('not_found', 'Account not found.', 404);
    return profileSchema.parse(result.rows[0]);
  }

  async update(ownerId: string, input: unknown): Promise<Profile> {
    const patch = profileUpdateSchema.parse(input);
    if (patch.photoDataUrl) {
      const encoded = patch.photoDataUrl.slice('data:image/jpeg;base64,'.length);
      const image = Buffer.from(encoded, 'base64');
      if (
        image.toString('base64') !== encoded ||
        image.length < 4 ||
        image[0] !== 0xff ||
        image[1] !== 0xd8 ||
        image[image.length - 2] !== 0xff ||
        image[image.length - 1] !== 0xd9
      ) {
        throw new DomainError('invalid_photo', 'Choose a valid JPEG profile photo.', 400);
      }
    }
    // Update only submitted fields: a name change must not erase a photo saved
    // by another device, and removing a photo must not overwrite the name.
    const result = await this.db.query<Profile>(
      `UPDATE recollect.users SET name=COALESCE($2,name),
       profile_photo_data_url=CASE WHEN $3 THEN $4 ELSE profile_photo_data_url END
       WHERE id=$1 AND is_active=true
       RETURNING id,name,profile_photo_data_url AS "photoDataUrl"`,
      [ownerId, patch.name ?? null, patch.photoDataUrl !== undefined, patch.photoDataUrl ?? null],
    );
    if (!result.rows[0]) throw new DomainError('not_found', 'Account not found.', 404);
    return profileSchema.parse(result.rows[0]);
  }
}
