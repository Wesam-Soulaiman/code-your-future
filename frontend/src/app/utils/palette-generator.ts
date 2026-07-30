/**
 * Color Palette Generator
 *
 * Generates a full color palette (50-950) from a single base color.
 * Usage:
 *   const primary = generatePalette('#10a699');
 *   const surface = generateSurfaceFromPrimary('#10a699');
 */

type ColorPalette = Record<number, string>;

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to HSL
 */
function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert HSL to RGB
 */
function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/**
 * Convert RGB to hex
 */
function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, n)).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Lightness values for each shade
 */
const SHADE_LIGHTNESS: Record<number, number> = {
  50: 97,
  100: 94,
  200: 86,
  300: 77,
  400: 66,
  500: 50,
  600: 41,
  700: 33,
  800: 24,
  900: 17,
  950: 10,
};

/**
 * Generate a color palette from a base color
 * Handles near-black and near-white colors gracefully
 */
export function generatePalette(baseColor: string): ColorPalette {
  const rgb = hexToRgb(baseColor);
  const hsl = rgbToHsl(rgb);

  const palette: ColorPalette = {};

  // For very low saturation (grays/blacks), create a neutral gray palette
  const isNeutral = hsl.s < 5;

  for (const [shade, lightness] of Object.entries(SHADE_LIGHTNESS)) {
    const shadeNum = parseInt(shade);
    let saturation = hsl.s;

    if (isNeutral) {
      // Pure grayscale for neutral colors
      saturation = 0;
    } else if (lightness > 90) {
      saturation = Math.max(hsl.s * 0.3, 10);
    } else if (lightness < 20) {
      saturation = Math.max(hsl.s * 0.7, 20);
    }

    const newHsl: HSL = {
      h: hsl.h,
      s: saturation,
      l: lightness,
    };

    palette[shadeNum] = rgbToHex(hslToRgb(newHsl));
  }

  return palette;
}

/**
 * Generate a neutral surface palette from a primary color
 * Takes the hue from primary but with very low saturation (subtle tint)
 */
export function generateSurfaceFromPrimary(primaryColor: string): ColorPalette & { 0: string } {
  const rgb = hexToRgb(primaryColor);
  const hsl = rgbToHsl(rgb);

  const palette: ColorPalette = {};

  for (const [shade, lightness] of Object.entries(SHADE_LIGHTNESS)) {
    const shadeNum = parseInt(shade);
    // Very low saturation (5-10%) for subtle tint from primary
    const saturation = lightness > 50 ? 5 : 8;

    const newHsl: HSL = {
      h: hsl.h,
      s: saturation,
      l: lightness,
    };

    palette[shadeNum] = rgbToHex(hslToRgb(newHsl));
  }

  return { 0: '#ffffff', ...palette };
}

/**
 * Generate a pure neutral gray surface (no tint)
 */
export function generateNeutralSurface(): ColorPalette & { 0: string } {
  const palette: ColorPalette = {};

  for (const [shade, lightness] of Object.entries(SHADE_LIGHTNESS)) {
    const shadeNum = parseInt(shade);
    const gray = Math.round((lightness / 100) * 255);
    palette[shadeNum] = rgbToHex({ r: gray, g: gray, b: gray });
  }

  return { 0: '#ffffff', ...palette };
}

/**
 * Calculate relative luminance of a color (WCAG formula)
 */
function getLuminance(rgb: RGB): number {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors (WCAG formula)
 */
function getContrastRatio(color1: RGB, color2: RGB): number {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Soft contrast colors (easier on the eyes than pure black/white)
 */
const SOFT_WHITE = '#fafafa'; // Off-white
const SOFT_BLACK = '#171717'; // Off-black

/**
 * Get the best contrast color for a given background
 * Uses soft black/white for better aesthetics
 */
export function getContrastColor(backgroundColor: string): string {
  const rgb = hexToRgb(backgroundColor);
  const white: RGB = { r: 250, g: 250, b: 250 }; // soft white
  const black: RGB = { r: 23, g: 23, b: 23 }; // soft black

  const contrastWithWhite = getContrastRatio(rgb, white);
  const contrastWithBlack = getContrastRatio(rgb, black);

  return contrastWithWhite >= contrastWithBlack ? SOFT_WHITE : SOFT_BLACK;
}

/**
 * Check if a color is "noir" (very dark or neutral)
 * Noir colors need different shade usage for good contrast
 */
export function isNoirColor(color: string): boolean {
  const rgb = hexToRgb(color);
  const hsl = rgbToHsl(rgb);
  // Noir if saturation < 10% or lightness < 20%
  return hsl.s < 10 || hsl.l < 20;
}

/**
 * Get contrast colors for all primary shades used in the theme
 * For noir themes, uses darker shades with white contrast
 */
export function getPrimaryContrastColors(primaryBase: string): {
  light: string;
  dark: string;
  isNoir: boolean;
  // Which shades to use for buttons
  lightShade: number;
  lightHoverShade: number;
  lightActiveShade: number;
  darkShade: number;
  darkHoverShade: number;
  darkActiveShade: number;
} {
  const palette = generatePalette(primaryBase);
  const noir = isNoirColor(primaryBase);

  if (noir) {
    // Noir theme: dark buttons with white text
    return {
      light: SOFT_WHITE,
      dark: SOFT_WHITE,
      isNoir: true,
      lightShade: 900,
      lightHoverShade: 800,
      lightActiveShade: 950,
      darkShade: 700,
      darkHoverShade: 600,
      darkActiveShade: 800,
    };
  }

  // Standard theme: use 500 as base, contrast depends on luminance
  const contrastLight = getContrastColor(palette[500]);
  const contrastDark = getContrastColor(palette[400]);

  return {
    light: contrastLight,
    dark: contrastDark,
    isNoir: false,
    lightShade: 500,
    lightHoverShade: 600,
    lightActiveShade: 700,
    darkShade: 400,
    darkHoverShade: 300,
    darkActiveShade: 500,
  };
}
