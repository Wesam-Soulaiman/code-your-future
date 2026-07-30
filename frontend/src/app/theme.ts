import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';
import { generatePalette, generateSurfaceFromPrimary, getPrimaryContrastColors } from './utils/palette-generator';

/**
 * Theme Configuration
 *
 * Only change PRIMARY_BASE - surface colors are derived automatically
 * with a subtle tint from your primary color.
 */
const PRIMARY_BASE = '#6096bb'; // Your brand color - change only this!

// Generate palettes and contrast colors automatically
const PRIMARY_COLOR = generatePalette(PRIMARY_BASE);
const SURFACE_COLOR = generateSurfaceFromPrimary(PRIMARY_BASE);
const CONTRAST = getPrimaryContrastColors(PRIMARY_BASE);

export const MyPreset = definePreset(Aura, {
  semantic: {
    transitionDuration: '0.2s',
    focusRing: {
      width: '1px',
      style: 'solid',
      color: '{primary.color}',
      offset: '2px',
      shadow: 'none',
    },
    disabledOpacity: '0.6',
    iconSize: '1rem',
    anchorGutter: '2px',
    primary: PRIMARY_COLOR,
    formField: {
      paddingX: '0.75rem',
      paddingY: '0.5rem',
      sm: { fontSize: '0.875rem', paddingX: '0.625rem', paddingY: '0.375rem' },
      lg: { fontSize: '1.125rem', paddingX: '0.875rem', paddingY: '0.625rem' },
      borderRadius: '{border.radius.md}',
      focusRing: { width: '0', style: 'none', color: 'transparent', offset: '0', shadow: 'none' },
      transitionDuration: '{transition.duration}',
    },
    list: {
      padding: '0.25rem 0.25rem',
      gap: '2px',
      header: { padding: '0.5rem 1rem 0.25rem 1rem' },
      option: { padding: '0.5rem 0.75rem', borderRadius: '{border.radius.sm}' },
      optionGroup: { padding: '0.5rem 0.75rem', fontWeight: '600' },
    },
    content: { borderRadius: '{border.radius.md}' },
    mask: { transitionDuration: '0.15s' },
    navigation: {
      list: { padding: '0.25rem 0.25rem', gap: '2px' },
      item: { padding: '0.5rem 0.75rem', borderRadius: '{border.radius.sm}', gap: '0.5rem' },
      submenuLabel: { padding: '0.5rem 0.75rem', fontWeight: '600' },
      submenuIcon: { size: '0.875rem' },
    },
    
    overlay: {
      select: {
        borderRadius: '{border.radius.md}',
        shadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
      },
      popover: {
        borderRadius: '{border.radius.md}',
        padding: '0.75rem',
        shadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
      },
      modal: {
        padding: '1.25rem',
        shadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
      },
      navigation: {
        shadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)',
      },
    },
    colorScheme: {
      light: {
        formField: {
          background: '{surface.0}',
        },
        primary: {
          color: `{primary.700}`,
          contrastColor: '#ffffff',
          hoverColor: `{primary.800}`,
          activeColor: `{primary.900}`,
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.700}',
          focusColor: '{primary.800}',
        },
        surface: SURFACE_COLOR,
      },
      dark: {
        formField: {
          background: '{surface.900}',
        },
        primary: {
          color: `{primary.${CONTRAST.darkShade}}`,
          contrastColor: CONTRAST.dark,
          hoverColor: `{primary.${CONTRAST.darkHoverShade}}`,
          activeColor: `{primary.${CONTRAST.darkActiveShade}}`,
        },
        highlight: {
          background: `color-mix(in srgb, {primary.${CONTRAST.darkShade}}, transparent 84%)`,
          focusBackground: `color-mix(in srgb, {primary.${CONTRAST.darkShade}}, transparent 76%)`,
          color: 'rgba(250,250,250,.87)',
          focusColor: 'rgba(250,250,250,.87)',
        },
        surface: SURFACE_COLOR,
      },
    },
  },
});
