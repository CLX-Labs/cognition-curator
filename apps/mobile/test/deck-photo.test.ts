import { beforeEach, expect, it, vi } from 'vitest';
import { MAX_DECK_IMAGE_LENGTH } from '@recollect/contracts';
const rig = vi.hoisted(() => ({
  pick: vi.fn(),
  crop: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  contextRelease: vi.fn(),
  imageRelease: vi.fn(),
  deleted: [] as string[],
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: rig.pick }));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => ({
      crop: rig.crop,
      resize: rig.resize,
      renderAsync: rig.render,
      release: rig.contextRelease,
    }),
  },
  SaveFormat: { JPEG: 'jpeg' },
}));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(private uri: string) {}
    delete() {
      rig.deleted.push(this.uri);
    }
  },
}));
import { chooseDeckPhoto } from '../src/deck-photo';
beforeEach(() => {
  vi.clearAllMocks();
  rig.deleted.length = 0;
  rig.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///original.jpg', width: 1200, height: 800 }],
  });
  rig.render.mockResolvedValue({ saveAsync: rig.save, release: rig.imageRelease });
  rig.save.mockResolvedValue({ uri: 'file:///normalized.jpg', base64: '/9j/2Q==' });
});
it('centers a selected photo as a square JPEG without requesting broad library access', async () => {
  expect(await chooseDeckPhoto()).toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(rig.pick).toHaveBeenCalledWith(
    expect.objectContaining({ mediaTypes: ['images'], aspect: [1, 1], exif: false }),
  );
  expect(rig.crop).toHaveBeenCalledWith({ originX: 200, originY: 0, width: 800, height: 800 });
  expect(rig.resize).toHaveBeenCalledWith({ width: 512, height: 512 });
  expect(rig.save).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', base64: true }));
  expect(rig.deleted).toEqual(['file:///normalized.jpg']);
  expect(rig.imageRelease).toHaveBeenCalledOnce();
  expect(rig.contextRelease).toHaveBeenCalledOnce();
});
it('reduces a large normalized cover until it fits the wire limit and cleans every generated file', async () => {
  rig.save
    .mockResolvedValueOnce({
      uri: 'file:///large-1.jpg',
      base64: 'A'.repeat(MAX_DECK_IMAGE_LENGTH),
    })
    .mockResolvedValueOnce({
      uri: 'file:///large-2.jpg',
      base64: 'A'.repeat(MAX_DECK_IMAGE_LENGTH),
    })
    .mockResolvedValueOnce({ uri: 'file:///bounded.jpg', base64: '/9j/2Q==' });
  expect((await chooseDeckPhoto())!.length).toBeLessThanOrEqual(MAX_DECK_IMAGE_LENGTH);
  expect(rig.resize.mock.calls).toEqual([
    [{ width: 512, height: 512 }],
    [{ width: 384, height: 384 }],
  ]);
  expect(rig.deleted).toEqual([
    'file:///large-1.jpg',
    'file:///large-2.jpg',
    'file:///bounded.jpg',
  ]);
  expect(rig.deleted).not.toContain('file:///original.jpg');
  expect(rig.imageRelease).toHaveBeenCalledTimes(2);
});
it('treats cancellation as no change and never processes the source', async () => {
  rig.pick.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await chooseDeckPhoto()).toBeNull();
  expect(rig.render).not.toHaveBeenCalled();
});
it('bounds every attempt and releases resources when even the smallest image is oversized', async () => {
  rig.save.mockResolvedValue({
    uri: 'file:///oversized.jpg',
    base64: 'A'.repeat(MAX_DECK_IMAGE_LENGTH),
  });
  await expect(chooseDeckPhoto()).rejects.toThrow('too large');
  expect(rig.save).toHaveBeenCalledTimes(4);
  expect(rig.contextRelease).toHaveBeenCalledOnce();
  expect(rig.deleted).toEqual(['file:///oversized.jpg']);
});
