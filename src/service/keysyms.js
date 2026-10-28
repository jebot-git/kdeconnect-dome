// SPDX-License-Identifier: GPL-2.0-or-later
// XKB key symbols used by the KDE Connect wire protocol; no display toolkit.
export default {"KEY_Alt_L": 65513, "KEY_BackSpace": 65288, "KEY_Control_L": 65507, "KEY_Delete": 65535, "KEY_Down": 65364, "KEY_End": 65367, "KEY_Escape": 65307, "KEY_F1": 65470, "KEY_F10": 65479, "KEY_F11": 65480, "KEY_F12": 65481, "KEY_F2": 65471, "KEY_F3": 65472, "KEY_F4": 65473, "KEY_F5": 65474, "KEY_F6": 65475, "KEY_F7": 65476, "KEY_F8": 65477, "KEY_F9": 65478, "KEY_Home": 65360, "KEY_Left": 65361, "KEY_Linefeed": 65290, "KEY_Page_Down": 65366, "KEY_Page_Up": 65365, "KEY_Return": 65293, "KEY_Right": 65363, "KEY_Scroll_Lock": 65300, "KEY_Shift_L": 65505, "KEY_Super_L": 65515, "KEY_Sys_Req": 65301, "KEY_Tab": 65289, "KEY_U": 85, "KEY_Up": 65362,
  BUTTON_PRIMARY: 1, BUTTON_MIDDLE: 2, BUTTON_SECONDARY: 3,
  ScrollDirection: {UP: 0},
  ModifierType: {SHIFT_MASK: 1, CONTROL_MASK: 4, MOD1_MASK: 8, SUPER_MASK: 67108864},
  unicode_to_keyval: cp => cp < 256 ? cp : 0x01000000 | cp,
};
