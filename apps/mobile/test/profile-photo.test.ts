import { beforeEach, expect, it, vi } from 'vitest';
const rig = vi.hoisted(() => ({
  pick: vi.fn(),
  crop: vi.fn(),
  resize: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  contextRelease: vi.fn(),
  imageRelease: vi.fn(),
  delete: vi.fn(),
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
    delete = rig.delete;
  },
}));
import { chooseProfilePhoto } from '../src/profile-photo';
beforeEach(() => {
  vi.clearAllMocks();
  rig.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///picked.jpg', width: 1200, height: 800 }],
  });
  rig.render.mockResolvedValue({ saveAsync: rig.save, release: rig.imageRelease });
  rig.save.mockResolvedValue({ uri: 'file:///resized.jpg', base64: '/9j/2Q==' });
});
it('normalizes a selected image to a small square JPEG and cleans up native image resources', async () => {
  expect(await chooseProfilePhoto()).toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(rig.pick).toHaveBeenCalledWith(
    expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true, exif: false }),
  );
  expect(rig.crop).toHaveBeenCalledWith({ originX: 200, originY: 0, width: 800, height: 800 });
  expect(rig.resize).toHaveBeenCalledWith({ width: 512, height: 512 });
  expect(rig.imageRelease).toHaveBeenCalledOnce();
  expect(rig.contextRelease).toHaveBeenCalledOnce();
  expect(rig.delete).toHaveBeenCalledOnce();
});
it('treats picker cancellation as no change', async () => {
  rig.pick.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await chooseProfilePhoto()).toBeNull();
  expect(rig.render).not.toHaveBeenCalled();
});
it('rejects an oversized normalized image and releases resources even on error', async () => {
  rig.save.mockResolvedValueOnce({ uri: 'file:///too-large.jpg', base64: 'A'.repeat(280_000) });
  await expect(chooseProfilePhoto()).rejects.toThrow('too large');
  expect(rig.contextRelease).toHaveBeenCalledOnce();
  expect(rig.imageRelease).toHaveBeenCalledOnce();
  expect(rig.delete).toHaveBeenCalledOnce();
});
