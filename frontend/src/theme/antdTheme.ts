import { theme } from 'antd';
import type { ThemeConfig } from 'antd';
import type { SemanticTokens } from './tokens';
import { radius, fontFamily, fontSize } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Maps our semantic tokens onto Ant Design's theme contract.
   ───────────────────────────────────────────────────────────────
   This replaces the `ghDarkTheme` object that was inlined in App.tsx.
   Same component overrides, but driven by tokens so the light theme
   comes out of the same code path rather than needing a parallel object.
═══════════════════════════════════════════════════════════════ */

export function buildAntdTheme(t: SemanticTokens): ThemeConfig {
    const isDark = t.mode === 'dark';

    return {
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,

        token: {
            colorPrimary:  t.accent,
            colorSuccess:  t.success,
            colorWarning:  t.warning,
            colorError:    t.danger,
            colorInfo:     t.info,

            colorBgBase:      t.bg,
            colorBgContainer: t.surface,
            colorBgElevated:  t.surfaceRaised,
            colorBgLayout:    t.bg,
            colorBgSpotlight: t.surfaceRaised,

            colorBorder:          t.border,
            colorBorderSecondary: t.borderSubtle,

            colorText:            t.text,
            colorTextSecondary:   t.textMuted,
            colorTextTertiary:    t.textFaint,
            colorTextQuaternary:  t.textFaint,

            colorLink:            t.accent,
            colorLinkHover:       t.accent,

            borderRadius:   radius.md,
            borderRadiusLG: radius.lg,
            borderRadiusSM: radius.sm,

            fontFamily,
            fontSize:      fontSize.base,
            controlHeight: 36,

            motionDurationMid: '0.15s',

            boxShadow:          t.shadowMd,
            boxShadowSecondary: t.shadowLg,
        },

        components: {
            Menu: {
                itemHeight: 36,
                // Light-mode keys
                itemBg:            t.surface,
                subMenuItemBg:     t.bg,
                itemSelectedBg:    t.selectedBg,
                itemSelectedColor: t.text,
                itemHoverBg:       t.hoverBg,
                itemColor:         t.textMuted,
                // Dark-mode keys — AntD reads a separate set when the Menu
                // is rendered with theme="dark", so both must be supplied.
                darkItemBg:            t.surface,
                darkSubMenuItemBg:     t.bg,
                darkItemSelectedBg:    t.selectedBg,
                darkItemSelectedColor: t.text,
                darkItemHoverBg:       t.hoverBg,
                darkItemColor:         t.textMuted,
            },

            Table: {
                headerBg:      t.surface,
                headerColor:   t.textMuted,
                rowHoverBg:    t.hoverBg,
                borderColor:   t.borderSubtle,
                colorBgContainer: t.surface,
            },

            Card: {
                colorBgContainer:     t.surface,
                colorBorderSecondary: t.border,
            },

            Modal: {
                contentBg:      t.surface,
                headerBg:       t.surface,
                footerBg:       t.surface,
                colorBgMask:    t.overlay,
                titleColor:     t.text,
            },

            Input: {
                colorBgContainer:  t.surfaceSunken,
                activeBorderColor: t.accent,
                hoverBorderColor:  t.borderStrong,
                colorBorder:       t.border,
            },

            InputNumber: {
                colorBgContainer:  t.surfaceSunken,
                activeBorderColor: t.accent,
                hoverBorderColor:  t.borderStrong,
                colorBorder:       t.border,
            },

            Select: {
                colorBgContainer:  t.surfaceSunken,
                optionSelectedBg:  t.accentBg,
                colorBgElevated:   t.surfaceRaised,
                colorBorder:       t.border,
            },

            DatePicker: {
                colorBgContainer: t.surfaceSunken,
                colorBgElevated:  t.surfaceRaised,
                colorBorder:      t.border,
            },

            Button: {
                defaultBg:          isDark ? t.surfaceRaised : t.surface,
                defaultBorderColor: t.border,
                defaultColor:       t.text,
                defaultHoverBg:     t.activeBg,
                defaultHoverColor:  t.text,
                primaryColor:       t.textOnAccent,
            },

            Tabs: {
                itemColor:         t.textMuted,
                itemSelectedColor: t.text,
                itemHoverColor:    t.text,
                inkBarColor:       t.accent,
            },

            Tooltip: {
                colorBgSpotlight: t.surfaceRaised,
                colorTextLightSolid: t.text,
            },

            Popover: {
                colorBgElevated: t.surfaceRaised,
            },

            Dropdown: {
                colorBgElevated: t.surfaceRaised,
            },

            Segmented: {
                itemColor:         t.textMuted,
                itemHoverColor:    t.text,
                itemSelectedBg:    t.surfaceRaised,
                itemSelectedColor: t.text,
                trackBg:           t.surfaceSunken,
            },

            Layout: {
                bodyBg:    t.bg,
                headerBg:  t.surface,
                siderBg:   t.surface,
                triggerBg: t.surfaceRaised,
            },

            Divider: {
                colorSplit: t.border,
            },

            Progress: {
                remainingColor: t.surfaceSunken,
            },

            Form: {
                labelColor: t.text,
                labelRequiredMarkColor: t.danger,
            },

            Alert: {
                colorInfoBg:    t.infoBg,
                colorInfoBorder: t.infoBorder,
                colorSuccessBg: t.successBg,
                colorSuccessBorder: t.successBorder,
                colorWarningBg: t.warningBg,
                colorWarningBorder: t.warningBorder,
                colorErrorBg:   t.dangerBg,
                colorErrorBorder: t.dangerBorder,
            },

            Empty: {
                colorTextDescription: t.textMuted,
            },
        },
    };
}
