import axios from 'axios';
import sharp = require('sharp');
import {encode} from 'blurhash';

export interface ImageProcessingResult {
  large: Parse.File;
  thumbnail: Parse.File;
  blurhash: string;
}

/**
 * Downloads image from URL and returns buffer
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  });
  return response.data;
}

/**
 * Resizes and converts image to WebP format
 */
export async function resizeToWebP(
  buffer: Buffer,
  options: {
    width: number;
    quality: number;
  }
): Promise<Buffer> {
  return sharp(buffer)
    .resize({
      width: options.width,
      withoutEnlargement: true,
    })
    .webp({
      quality: options.quality,
    })
    .toBuffer();
}

/**
 * Generates blurhash from image buffer
 */
export async function generateBlurhash(
  buffer: Buffer,
  componentX: number = 4,
  componentY: number = 4
): Promise<string> {
  const resizedImage = await sharp(buffer)
    .resize({width: 100})
    .raw()
    .ensureAlpha()
    .toBuffer({resolveWithObject: true});

  const {data, info} = resizedImage;

  return encode(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    componentX,
    componentY
  );
}

/**
 * Processes image: creates large and thumbnail versions + blurhash
 */
export async function processImage(
  imageUrl: string
): Promise<ImageProcessingResult> {
  const buffer = await downloadImage(imageUrl);

  // Generate large version (1000px, 70% quality)
  const largeBuffer = await resizeToWebP(buffer, {
    width: 1000,
    quality: 70,
  });
  const largeFile = await new Parse.File('im.webp', {
    base64: largeBuffer.toString('base64'),
  }).save({useMasterKey: true});

  // Generate thumbnail (1000px, 30% quality)
  const thumbBuffer = await resizeToWebP(buffer, {
    width: 1000,
    quality: 30,
  });
  const thumbFile = await new Parse.File('th.webp', {
    base64: thumbBuffer.toString('base64'),
  }).save({useMasterKey: true});

  // Generate blurhash
  const blurhash = await generateBlurhash(buffer);

  return {
    large: largeFile,
    thumbnail: thumbFile,
    blurhash,
  };
}
