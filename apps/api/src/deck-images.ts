import { deckImageSchema } from '@recollect/contracts';
import { DomainError } from '@recollect/db';

function invalid(): never {
  throw new DomainError(
    'invalid_deck_image',
    'Choose a square JPEG cover up to 1,024 pixels wide.',
    400,
  );
}

/** Bound the image before native decoders see it. No remote image fetches. */
export function assertDeckImage(value: string | null | undefined) {
  if (value == null) return;
  if (!deckImageSchema.safeParse(value).success) return invalid();
  const encoded = value.slice('data:image/jpeg;base64,'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.toString('base64') !== encoded ||
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  )
    return invalid();
  let offset = 2,
    frame = false,
    scan = false,
    quantization = false,
    huffman = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length || !frame || !scan || !quantization || !huffman) return invalid();
      return;
    }
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      return invalid();
    if (offset + 2 > bytes.length) return invalid();
    const length = bytes.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > bytes.length) return invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || length < 11) return invalid();
      const height = bytes.readUInt16BE(offset + 3),
        width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7]!;
      if (
        bytes[offset + 2] !== 8 ||
        !width ||
        width !== height ||
        width > 1024 ||
        ![1, 3].includes(components) ||
        length !== 8 + 3 * components
      )
        return invalid();
      frame = true;
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return invalid();
    if (marker === 0xdb) quantization = true;
    if (marker === 0xc4) huffman = true;
    offset = end;
    if (marker === 0xda) {
      if (!frame || !quantization || !huffman || length < 6) return invalid();
      scan = true;
      // Entropy data permits escaped FF bytes and restart markers. Other
      // markers end this scan (progressive JPEGs can contain several scans).
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        const code = bytes[next];
        if (code === 0 || (code !== undefined && code >= 0xd0 && code <= 0xd7)) offset = next + 1;
        else break;
      }
    }
  }
  return invalid();
}

/** Legacy responses omit the new field only from deck-shaped records. */
export function legacyDeckImageResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyDeckImageResponse);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  const object = value as Record<string, unknown>;
  const deck =
    typeof object.name === 'string' &&
    typeof object.description === 'string' &&
    typeof object.color === 'string' &&
    typeof object.icon === 'string';
  return Object.fromEntries(
    Object.entries(object)
      .filter(([key]) => !(deck && key === 'imageDataUrl'))
      .map(([key, entry]) => [key, legacyDeckImageResponse(entry)]),
  );
}
