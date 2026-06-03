import sharp from 'sharp';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, 'public/icons/KCFZ0298.JPG');
const outDir = join(__dirname, 'public/icons');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

async function generateIcons() {
  console.log('Generating icons from KCFZ0298.JPG...');

  for (const size of SIZES) {
    await sharp(sourcePath)
      .resize(size, size, {
        fit: 'cover',
        position: 'centre',
        background: { r: 26, g: 115, b: 232, alpha: 1 }
      })
      .png({ compressionLevel: 9 })
      .toFile(join(outDir, `icon-${size}x${size}.png`));
    console.log(`  ✓ icon-${size}x${size}.png`);
  }

  await sharp(sourcePath)
    .resize(180, 180, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(join(outDir, 'apple-touch-icon.png'));
  console.log('  ✓ apple-touch-icon.png');

  await sharp(sourcePath)
    .resize(32, 32, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(join(__dirname, 'public/favicon-32x32.png'));
  console.log('  ✓ favicon-32x32.png');

  console.log('\nDone!');
}

generateIcons().catch(console.error);
